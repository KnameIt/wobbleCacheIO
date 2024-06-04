const http = require("http");
const socketIO = require("socket.io", {
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000
});
const cors = require("cors");

const server = http.createServer();
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

var AWS = require("aws-sdk");
const axios = require("axios");
const { v4: uuidv4, parse } = require("uuid");
const { MongoClient, ObjectId } = require("mongodb");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { Client, Connection } = require("@opensearch-project/opensearch");
const { AwsSigv4Signer } = require("@opensearch-project/opensearch/aws");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const lambda = new LambdaClient({ region: "us-east-1" });

const { fromEnv } = require("@aws-sdk/credential-provider-env");
let serverStorage = {};
let apiData = {};
let lambdaSocketIds = {};
let assetsNeededPages = {};
let tempResponseObject = {};
let finalLambdaResponse = {};
let socketInterval;
let cursorPositions = {};
// Replace with your OpenSearch cluster endpoint
const OPENSEARCH_ENDPOINT =
  "https://search-global-cache-lzfadkxiisl4psussg724mjv6i.us-east-1.es.amazonaws.com";

const credentials = fromEnv();

console.log("credientials", credentials);

const clientOpensearch = new Client({
  ...AwsSigv4Signer({
    region: "us-east-1",
    service: "es",
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: "https://search-global-cache-lzfadkxiisl4psussg724mjv6i.us-east-1.es.amazonaws.com",
});

async function checkClusterHealth() {
  try {
    const response = await clientOpensearch.transport.request({
      method: "GET",
      path: "/_cluster/health",
    });
    console.log("Cluster health:", response.body);
  } catch (error) {
    console.error("Error checking cluster health:", error);
  }
}

async function ensureIndexExists(indexName) {
  try {
    // Check if the index exists
    const indexExistsResponse = await clientOpensearch.indices.exists({
      index: indexName,
    });

    if (
      !indexExistsResponse.statusCode ||
      indexExistsResponse.statusCode === 404
    ) {
      // Create the index if it doesn't exist
      const createIndexResponse = await clientOpensearch.indices.create({
        index: indexName,
      });

      if (createIndexResponse.statusCode === 200) {
        console.log(`Index "${indexName}" created successfully.`);
      } else {
        console.error(
          `Error creating index "${indexName}":`,
          createIndexResponse
        );
      }
    } else {
      console.log(`Index "${indexName}" already exists.`);
    }
  } catch (error) {
    console.error(`Error ensuring index "${indexName}" exists:`, error);
  }
}

async function bulkImportToOpenSearch(index, items) {
  const bulkBody = [];
  // console.log("items", items[0]);
  items.forEach((item) => {
    //   bulkBody.push({ index: { _index: index, _id: item.id } });
    bulkBody.push(item);
  });
  // console.log('clientOpensearch', clientOpensearch);

  // await checkClusterHealth();
  // console.log('bulkBody', bulkBody[0]);
  try {
    const response = await clientOpensearch.helpers.bulk({
      datasource: items,
      onDocument(doc) {
        return {
          index: { _index: "globalcache", _id: doc.id },
        };
      },
    });
    console.log("Bulk import response:", response);
  } catch (error) {
    console.error("Error during bulk import:", error);
  }
}

async function extractSourceContent(array) {
  return array.map((item) => item._source);
}

async function autosearchGlobalCache(searchParamsQuery) {
  // first, make sure we're pulling results that match teh vendporEndpointId
  // Then we need to go through the queryComponents for each

  // console.log('lockLists', lockLists);
  // convert from array to string
  // lockLists = lockLists.join(',');
  // console.log('lockLists', lockLists);
  console.log("searchParamsQuery", searchParamsQuery);
  const index = "globalcache";
  let query = "";
  // console.log('whatWeNeed', whatWeNeed);
  // console.log('endpoint', endpoint);
  // console.log('event', event);
  // console.log('query', query);
  console.log("index", index);
  try {
    const response = await clientOpensearch.search({
      index: index,
      body: {
        size: 10,
        query: {
          multi_match: {
            query: searchParamsQuery,
            fields: ["*"],
          },
        },
      },
    });
    console.log("AutoSearch response:", response.body.hits.hits.length);
    let searchResults = response.body.hits.hits;
    const searchResultsSource = extractSourceContent(searchResults);
    return searchResultsSource;
  } catch (error) {
    console.error("Error during search:", error);
  }
}

async function searchOpenSearchGlobalCache(endpoint, lockLists, event) {
  // first, make sure we're pulling results that match teh vendporEndpointId
  // Then we need to go through the queryComponents for each

  console.log("lockLists", lockLists);
  // convert from array to string
  lockLists = lockLists.join(",");
  console.log("lockLists", lockLists);
  const index = "globalcache";
  let query = "";
  // console.log('whatWeNeed', whatWeNeed);
  console.log("endpoint", endpoint);
  console.log("event", event);
  console.log("query", query);
  console.log("index", index);

  // check if index exists
  await ensureIndexExists(index);

  try {
    const response = await clientOpensearch.search({
      index: index,
      body: {
        size: endpoint.needed,
        query: {
          multi_match: {
            query: lockLists,
            fields: ["*"],
          },
        },
      },
    });
    console.log("clientOpensearch", clientOpensearch);
    console.log("response: ", response);
    console.log("response.body.hits.hits =====> ", response.body.hits.hits);
    console.log("Search response:", response.body?.hits?.hits?.length);
    let searchResults = response.body?.hits?.hits;
    console.log("searchResults : ", searchResults);
    const searchResultsSource = extractSourceContent(searchResults);
    // socket.emit('searchResults', searchResultsSource);
    return searchResultsSource;
  } catch (error) {
    console.error("Error during search:", error);
  }
}

const fetch = require("node-fetch");
const { object } = require("webidl-conversions");

const GRAPHQL_ENDPOINT = process.env.API_KNAMEITSTORE_GRAPHQLAPIENDPOINTOUTPUT;
const GRAPHQL_API_KEY = process.env.API_KNAMEITSTORE_GRAPHQLAPIKEYOUTPUT;

var host =
  "https://search-wobble-global-cache-zebpv2nopfg6cvdehhet7msv3u.us-east-1.es.amazonaws.com";
// aws appsync client

const table = "Item-c5puinrxsne5bejniknqzdntna-staging";
const tableName = "Item-c5puinrxsne5bejniknqzdntna-staging";
const tableNameProcess = process.env.API_KNAMEITSTORE_ITEMTABLE_NAME;
console.log("tableNameProcess", tableNameProcess);

const query = `query MyQuery {
        listItems(filter: {or: {name: {contains: ""}}}) {
          items {
                id
                name
                keywords
                src
                content
                access
                userId
                ingredientId
                ingredientName
                ingredientType
                projectId
                searchId
                clientId
                cachingChoices
                assetVendorId
                vendorEndpointId
          }
        }
  }`;

const query2 = `
  mutation MyMutation($access: String!, $assetVendorId: String!, $cachingChoices: String!, $clientId: String!, $content: String!, $id: String!, $ingredientId: String!, $ingredientName: String!, $ingredientType: String!, $keywords: String!, $name: String!, $projectId: String!, $searchId: String!, $src: String!, $userId: String!, $vendorEndpointId: String!) {
    createItem(input: {
      access: $access,
      assetVendorId: $assetVendorId,
      cachingChoices: $cachingChoices,
      clientId: $clientId,
      content: $content,
      id: $id,
      ingredientId: $ingredientId,
      ingredientName: $ingredientName,
      ingredientType: $ingredientType,
      keywords: $keywords,
      name: $name,
      projectId: $projectId,
      searchId: $searchId,
      src: $src,
      userId: $userId,
      vendorEndpointId: $vendorEndpointId
    }) {
      id
    }
  }
`;

// Done
async function searchAmplifyGraphQL(query) {
  // console.log('------ searchAmplifyGraphQL', query);

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": GRAPHQL_API_KEY,
    },
    body: JSON.stringify({ query: query }),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status code: ${response.status}`);
  }

  const json = await response.json();
  // console.log('json: ', json);
  return json;
}

async function insertIntoAmplifyGraphQL(query2, apiSearchResults) {
  // console.log('------ searchAmplifyGraphQL', query);
  // file and collect all of the items that need to be inserted into the graphql endpoint

  const variables = {
    access: housingObject.access,
    assetVendorId: housingObject.assetVendorId,
    cachingChoices: housingObject.cachingChoices,
    clientId: housingObject.clientId,
    content: housingObject.content,
    id: housingObject.id,
    ingredientId: housingObject.ingredientId,
    ingredientName: housingObject.ingredientName,
    ingredientType: housingObject.ingredientType,
    keywords: housingObject.keywords,
    name: housingObject.name,
    projectId: housingObject.projectId,
    searchId: housingObject.searchId,
    src: housingObject.src,
    userId: housingObject.userId,
    vendorEndpointId: housingObject.vendorEndpointId,
  };

  const responseInserted = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: query2,
      variables: variables,
    }),
  })
    .then((response) => response.json())
    .then((data) => console.log(data))
    .catch((error) => console.error(error));

  if (!responseInserted.ok) {
    throw new Error(
      `Request failed with status code: ${responseInserted.status}`
    );
  }

  const json = await response.json();
  console.log("json: ", json);
  return json;
}

async function sendToOpenSearchGlobalCache(apiSearchResults) {
  // console.log('client', clientOpensearch);
  const index = "globalcache"; // Get from Environment variables.
  const indexName = "globalcache";
  console.log("inside sendToOpenSearchGlobalCache");
  // await createIndexIfNotExists(indexName);
  await ensureIndexExists(indexName);
  console.log("createIndexIfNotExists complete");
  await bulkImportToOpenSearch(indexName, apiSearchResults);
  // await writeDocument(client, index, apiSearchResults);
  console.log("writeDocument complete");
  return;
}

async function writeDocument(client, index, doc) {
  const document = {
    doc,
  };

  const response = await client.index({
    index: index,
    body: document,
  });
  return response.body;
}

async function searchGlobalCache(whatWeNeed, event) {
  let globalCacheAssets = [];
  let missingAssets = [];
  let globalCacheResults = [];

  const promises = whatWeNeed.map(async (endpoint) => {
    try {
      console.log("endpoint: ", endpoint.queryComponents);

      const jsonData = endpoint;

      let lockLists = [];

      jsonData.queryComponents.forEach((component) => {
        component.properties.forEach((property) => {
          console.log("property: ", property);
          if (property.propertyType.cacheApi || property.propertyType.array) {
            lockLists = lockLists.concat(property.locks);
          }
        });
      });

      console.log("lockLists: ", JSON.stringify(lockLists));

      const response = await searchOpenSearchGlobalCache(
        endpoint,
        lockLists,
        event
      );

      console.log("response: ", response);

      const responseLength = response.length;
      // More than enough was found, we can push to globalCacheAssets
      if (responseLength > endpoint.needed) {
        // let cacheItems;
        // cacheItems.items = response.data.listItems.items;
        // cacheItems.searchId = endpoint.searchId;
        // cacheItems.needed = endpoint.needed;
        // cacheItems.supplied = responseLength;
        // // console.log('cacheItems: ', cacheItems);
        // globalCacheAssets.push(cacheItems);
      }
      // Not enough were found, we need to file missingAsset request
      else if (responseLength < endpoint.needed) {
        var cacheItems = response;
        cacheItems.forEach(function (item) {
          item.searchId = endpoint.searchId;
          item.ingredientType = endpoint.ingredientType;
          item.ingredientId = endpoint.ingredientId;
          item.ingredientName = endpoint.ingredientName;
          item.needed = endpoint.needed;
          item.supplied = responseLength;
          item.vendorEndpointId = endpoint.vendorEndpointId;
          item.userId = endpoint.userId;
          item.cachingChoices = endpoint.cachingChoices[0];
          globalCacheAssets.push(item);
        });

        endpoint.needed = endpoint.needed - responseLength;
        console.log("not enough: ", endpoint);
        missingAssets.push(endpoint);
      }
    } catch (error) {
      console.log("error: ", error);
    }
  });

  await Promise.all(promises);
  // console.log('globalCacheAssets: ', globalCacheAssets);

  globalCacheResults.globalCacheAssets = globalCacheAssets;
  globalCacheResults.missingAssets = missingAssets;

  return globalCacheResults;
}

let uri =
  "mongodb://knameit:knameit-admin@knameit-shard-00-00-13mhb.mongodb.net:27017,knameit-shard-00-01-13mhb.mongodb.net:27017,knameit-shard-00-02-13mhb.mongodb.net:27017/knameit?ssl=true&replicaSet=knameit-shard-0&authSource=admin&retryWrites=true";
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function getOAuthToken(missingAssetOrder) {
  await client.connect();
  const database = client.db("knameit");
  if (missingAssetOrder.oAuthRequired) {
    //   console.log("oAuthRequired: ", missingAssetOrder.oAuthRequired);
    //   console.log("missingAssetOrder.assetVendorId: ", missingAssetOrder.assetVendorId);
    const integrationsUserData = database.collection("integrationsUserData");
    const result = await integrationsUserData.findOne({
      userId: missingAssetOrder.userId,
      integrationProfiles: {
        $elemMatch: {
          assetVendorId: missingAssetOrder.assetVendorId,
        },
      },
    });
    //   console.log('result from integraitonUserDataFind: ', result);

    if (result) {
      // find the integrationProfile that matches the assetVendorId
      let integrationProfile = result.integrationProfiles.find(function (
        element
      ) {
        return element.assetVendorId === missingAssetOrder.assetVendorId;
      });

      missingAssetOrder.oAuthToken = integrationProfile.oAuthToken;
      // missingAssetOrder.oAuthTokenExpiration =
      //   integrationProfile.oAuthTokenExpiration;

      // console.log("missingAssetOrder: ", missingAssetOrder);
    }

    //   console.log("missingAssetOrder token: ", missingAssetOrder.oAuthToken);
    return missingAssetOrder.oAuthToken;
  }
}

async function fetchIntervalDetail() {
  try {
    await client.connect();
    const database = client.db("knameit");
    const userConfigData = database.collection("userConfig");
    const result = await userConfigData.findOne({});
    await client.close();
    console.log("result : ", result);
    socketInterval = result.userStatusInterval
    return socketInterval
  } catch (error) {
    console.error("Error : ", error);
  }
  finally {
    await client.close();
  }

}

async function lambdaFunctionInvoke(missingAssetOrder) {
  console.log("lambda ready to Invoke.......", missingAssetOrder.pendingPages);
  const functionARN = missingAssetOrder.liveLambdaARN;
  if (missingAssetOrder.oAuthRequired) {
    const token = await getOAuthToken(missingAssetOrder);
    console.log("token: ", token);
    missingAssetOrder.token = token;

    console.log("token data", token);
  }
  if (functionARN) {
    console.log("Lambda Function ARN: ", functionARN);
    console.log('missingAssetOrder: ', missingAssetOrder);
    const payload = JSON.stringify(missingAssetOrder);


    console.info("cred=====>", credentials)
    const command = new InvokeCommand({
      FunctionName: functionARN,
      InvocationType: "RequestResponse",
      Payload: payload,
    });
    console.info("command=>>", command)

    //   promises.push(
    lambda
      .send(command)
      .then(async (data) => {
        const responseBuffer = Buffer.from(data.Payload);
        // console.log('responseBuffer: ', responseBuffer);
        //s-11-01-2024
        let resultData = await JSON.parse(responseBuffer.toString("utf8"));
        //e-11-01-2024
        // console.log("functionARN event response data ", resultData);
        // let insertRecords = await  (socket, resultData);
        // console.log("insertRecords: ", insertRecords);
        // socket.emit("searchResults", resultData);
        return resultData;
      })
      .catch((err) => {
        console.error(err);
      });
    //   );
  } else {
    console.log("No functionARN");
  }
}

//1-10-24 added socket in params
async function apiSearch(missingAssets, socket) {
  //   const promises = [];

  // console.log("missingAssets: 485 ", missingAssets);

  for (let i = 0; i < missingAssets.length; i++) {
    const functionARN = missingAssets[i].liveLambdaARN;
    const missingAssetOrder = missingAssets[i];
    missingAssetOrder.ip = process.env.IP || "34.203.199.165";
    missingAssetOrder.port = process.env.PORT || 3005;
    missingAssetOrder.pendingPages = [];
    // assetsNeededPages[missingAssets[i].searchId] = {}
    // assetsNeededPages[missingAssets[i].searchId].totalPages = Math.ceil((missingAssets[i].needed) / 100);
    // assetsNeededPages[missingAssets[i].searchId].event = missingAssetOrder
    const lambdaResponse = await lambdaFunctionInvoke(missingAssetOrder);
    // if (missingAssetOrder.oAuthRequired) {
    //   const token = await getOAuthToken(missingAssetOrder);
    //   console.log("token: ", token);
    //   missingAssetOrder.token = token;

    //   console.log("token data", token);
    // }
    // if (functionARN) {
    //   console.log("functionARN: 498 ", functionARN);
    //   //console.log('missingAssetOrder: ', missingAssetOrder);
    //   const payload = JSON.stringify(missingAssetOrder);

    //   const command = new InvokeCommand({
    //     FunctionName: functionARN,
    //     InvocationType: "RequestResponse",
    //     Payload: payload,
    //   });

    //   //   promises.push(
    //   lambda
    //     .send(command)
    //     .then(async (data) => {
    //       const responseBuffer = Buffer.from(data.Payload);
    //       // console.log('responseBuffer: ', responseBuffer);
    //       //s-11-01-2024
    //       let resultData = await JSON.parse(responseBuffer.toString("utf8"));
    //       //e-11-01-2024
    //       // console.log("functionARN event response data ", resultData);
    //       // let insertRecords = await  (socket, resultData);
    //       // console.log("insertRecords: ", insertRecords);
    //       // socket.emit("searchResults", resultData);
    //       return resultData;
    //     })
    //     .catch((err) => {
    //       console.error(err);
    //     });
    //   //   );
    // } else {
    //   console.log("No functionARN");
    // }
  }
  //   testing build
  //   const results = await Promise.all(promises);
  console.log("lambda function call: 532 ");
  return "lambda function call";
}

async function processWobbleCacheRequest(event) {
  let ingredientCount = 0;
  let gridCount = event.limit;
  let preWobbleCount = 4;
  let pages = event.boards;

  let whatWeNeed = [];
  const transformedPayload = {
    endpoints: [],
  };
  // Grab the payload from the event
  let wobbleRequest = event;
  // console.log('wobbleRequest: ', wobbleRequest);

  // Grab the ingredients from the payload
  let ingredients = wobbleRequest.assetsNeeded;
  ingredientCount = ingredients.length;
  // console.log('ingredients: ', ingredients);
  // console.log('ingredientCount: ', ingredientCount);

  // Show how many I need for this ingredient
  let assetsNeeded = ingredientCount * preWobbleCount * gridCount * pages;
  console.log('assetsNeeded: ', assetsNeeded);

  let perIngredientAssetsNeeded = assetsNeeded / ingredientCount;

  // figure out the total number of endpoints per ingredient

  // for each ingredient, grab all of the checked Asset Vendors with their endpoints and all of the properties where cacheSearchAPI value is true.

  transformedPayload.ingredientCount = ingredientCount;
  transformedPayload.gridCount = gridCount;
  transformedPayload.preWobbleCount = preWobbleCount;
  transformedPayload.assetsNeeded = assetsNeeded;

  wobbleRequest.assetsNeeded.forEach((assetNeeded) => {
    var totalNeededPerIngredient = perIngredientAssetsNeeded;

    var perAssetVendorNeeded =
      totalNeededPerIngredient / assetNeeded.assetVendors.length;
    assetNeeded.assetVendors.forEach((assetVendor) => {
      assetVendor.vendorEndpoints.forEach((vendorEndpoint) => {
        var totalNeededPerEndpoint =
          perAssetVendorNeeded / assetVendor.vendorEndpoints.length;
        transformedPayload.endpoints.push({
          needed: totalNeededPerEndpoint,
          assetVendorName: assetVendor.name,
          ingredientName: assetNeeded.name,
          searchId: assetNeeded._id,
          userId: wobbleRequest.userId,
          clientId: wobbleRequest.clientId,
          projectId: wobbleRequest.projectId,
          activeTasteId: wobbleRequest.activeTasteId,
          ingredientId: assetNeeded._id,
          ingredientType: assetNeeded.ingredientType,
          assetVendorId: assetVendor.id,
          vendorEndpointId: vendorEndpoint.id,
          vendorEndpointName: vendorEndpoint.name,
          defaultPerPage: vendorEndpoint.defaultPerPage,
          liveLambdaUrl: vendorEndpoint.liveLambdaUrl,
          liveLambdaARN: vendorEndpoint.liveLambdaARN,
          lambdaPath: vendorEndpoint.lambdaPath,
          oAuthAvailable: vendorEndpoint.oAuthAvailable,
          oAuthRequired: vendorEndpoint.oAuthRequired,
          cachingChoices: vendorEndpoint.cachingChoices,
          vendorEndpointId: vendorEndpoint.id,
          vendorEndpointName: vendorEndpoint.name,
          queryComponents: assetNeeded.components,
        });
      });
    });
  });

  // console.log(transformedPayload);
  return transformedPayload;
}

async function sendToMongoWobbleCache(
  wobbleCache,
  wobbleCacheMode,
  suppliedWobbleCacheKey
) {
  // // // connnecte to mongodb and upload the results to the wobbleCache directory
  let uri =
    "mongodb://knameit:knameit-admin@knameit-shard-00-00-13mhb.mongodb.net:27017,knameit-shard-00-01-13mhb.mongodb.net:27017,knameit-shard-00-02-13mhb.mongodb.net:27017/knameit?ssl=true&replicaSet=knameit-shard-0&authSource=admin&retryWrites=true";
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  const database = client.db("knameit");
  const wobbleCacheCollection = database.collection("wobbleCache");

  if (wobbleCacheMode === "replace") {
    const result = await wobbleCacheCollection.replaceOne(
      { _id: suppliedWobbleCacheKey },
      wobbleCache
    );

    // console.log('result: ', result);
    return result;
  } else if (wobbleCacheMode === "add") {
    const result = await wobbleCacheCollection.updateOne(
      { _id: suppliedWobbleCacheKey },
      { $push: { items: { $each: wobbleCache.items } } }
    );
    return result;
  } else if (wobbleCacheMode === "create") {
    wobbleCache._id = uuidv4();
    const result = await wobbleCacheCollection.insertOne(wobbleCache);
    return result;
  }

  // return result;
}

// app.use(cors());

async function clientSocketLamda(clientParams) {
  const payload = JSON.stringify(clientParams, null, 2);
  const command = new InvokeCommand({
    FunctionName: "clientSocketFunction-staging",
    InvocationType: "RequestResponse",
    Payload: payload,
  });

  lambda
    .send(command)
    .then((data) => {
      console.info("Lambda Response: ", data);
    })
    .catch((err) => {
      console.error(err);
    });
  console.info("End of clientSocketLamda Method");
}

//updated insertDB function
async function insertDB(searchId) {
  console.info("Payload ready to insert in Database.......", searchId);
  // console.info("finalLambdaResponse[searchId]: ", finalLambdaResponse[searchId]);
  let lambdaResponseObject = Object.values(finalLambdaResponse[searchId])
  let pagesItem = [];
  lambdaResponseObject.map((element) => {
    let pages = Object.values(element.results)
    pagesItem.push(...pages);
  })
  // console.log("pagesItems: ", pagesItem.flat(1));
  const dbPayload = {
    results: pagesItem.flat(1),
    ingredientName: lambdaResponseObject[0].ingredientName,
    ingredientId: lambdaResponseObject[0].ingredientId,
    ingredientType: lambdaResponseObject[0].ingredientType,
    vendorEndpointId: lambdaResponseObject[0].vendorEndpointId,
    assetVendorId: lambdaResponseObject[0].assetVendorId,
    needed: lambdaResponseObject[0].needed,
    cachingChoices: lambdaResponseObject[0].cachingChoices,
    searchId: lambdaResponseObject[0].searchId,
    userId: lambdaResponseObject[0].userId
  };
  console.log("dbPayload results length: ", dbPayload.results.length);
  // delete finalLambdaResponse[searchId]
  // delete tempResponseObject[searchId]
  let apiCacheResults = dbPayload.results;
  console.log(
    "serverStorage[searchId].clientSocketId : 683 ",
    serverStorage[searchId].clientSocketId
  );
  io.to(serverStorage[searchId].clientSocketId).emit(
    "searchResults",
    apiCacheResults
  );
  let wobbleCache = serverStorage[searchId].wobbleCache;
  let wobbleCacheMode = serverStorage[searchId].wobbleCacheMode;
  let suppliedWobbleCacheKey = serverStorage[searchId].suppliedWobbleCacheKey;
  let globalCacheAssets = serverStorage[searchId].globalCacheAssets;

  let apiSearchResults = [];
  if (apiCacheResults != undefined) {
    // let objectIterate = Object.values(apiCacheResults);
    apiCacheResults.forEach((apiResult, index) => {
      // console.info("index: ", index)
      // pageWiseResult.forEach((apiResult) => {
      const globalCacheItem = {};
      globalCacheItem.id = dbPayload.assetVendorId + "-" + apiResult.id;
      globalCacheItem.src = apiResult.urls;
      // globalCacheItem.pageNumber = index+1;
      globalCacheItem.keywords = apiResult.tags;
      globalCacheItem.content = apiResult;
      globalCacheItem.userId = dbPayload.userId;
      globalCacheItem.searchId = dbPayload.searchId;
      globalCacheItem.ingredientId = dbPayload.ingredientId;
      globalCacheItem.ingredientName = dbPayload.ingredientName;
      globalCacheItem.ingredientType = dbPayload.ingredientType;
      globalCacheItem.assetVendorId = dbPayload.assetVendorId;
      globalCacheItem.vendorEndpointId = dbPayload.vendorEndpointId;
      if (dbPayload.vendorEndpointId === "clcaxnyytj0o50ak472r3y299") {
        globalCacheItem.src = apiResult.urls.regular;
      } else if (
        dbPayload.vendorEndpointId === "clcecey82qevd0ake6o2v1id2"
      ) {
        // console.log("apiResult", apiResult.previews.live_site);
        globalCacheItem.src = apiResult?.previews?.live_site?.url;
      }
      apiSearchResults.push(globalCacheItem);
      // });
    });
  }
  wobbleCache.items = globalCacheAssets.concat(apiSearchResults);
  io.to(serverStorage[searchId].clientSocketId).emit(
    "searchResults",
    wobbleCache
  );

  //15/01/2024
  const wobbleCacheKey = await sendToMongoWobbleCache(
    wobbleCache,
    wobbleCacheMode,
    suppliedWobbleCacheKey
  );

  io.to(serverStorage[searchId].clientSocketId).emit(
    "wobbleCacheKey",
    wobbleCacheKey
  );
  console.log("sending to Global Cache");

  if (wobbleCacheKey?.acknowledged) {
    delete apiData[searchId];
    delete serverStorage[searchId];
    delete finalLambdaResponse[searchId];
    delete tempResponseObject[searchId];
  }
  Promise.resolve(sendToOpenSearchGlobalCache(apiSearchResults)).catch(
    (error) => {
      console.error("Error sending data to OpenSearch Global Cache:", error);
    }
  );
  console.log("wobbleCacheKey:1 ", wobbleCacheKey);
  return wobbleCacheKey.insertedId;
}

function findMissingValues(first, second) {
  const spreaded = [...first, ...second];
  return spreaded.filter(el => {
    return !(first.includes(el) && second.includes(el));
  })
}

async function verifyLambdaResponse(lambdaEvent) {
  try {
    // console.info("searchId inside verifyLambdaResponse: ", lambdaEvent);
    console.info("searchId in verifyLambdaResponse: ", lambdaEvent.searchId);
    console.info("needed: ", lambdaEvent.needed);
    const searchId = lambdaEvent.searchId;
    console.info("finalLambdaResponse[searchId]: ", finalLambdaResponse[searchId]);
    if (finalLambdaResponse[searchId] != undefined || finalLambdaResponse[searchId] != null) {
      console.info("finalLambdaResponse[searchId] array: ", Object.keys(finalLambdaResponse[searchId]));
      if (Object.keys(finalLambdaResponse[searchId]).length > 0) {
        //checking pages level
        const pagesCount = Object.keys(finalLambdaResponse[searchId]);
        const pagesNeeded = Object.values(finalLambdaResponse[searchId])[0];
        console.info("pages : ", pagesCount);
        console.info("pageCount: ", pagesCount?.length);
        console.info("pageNeeded value: ", pagesNeeded?.pagesNeeded);
        if (pagesCount.length != pagesNeeded?.pagesNeeded) {
          const pagesArray = pagesCount.map(element => Number(element.replace(/'/g, '')));
          console.info("pagesArray: ", pagesArray);
          let originalArrayLength = Array.from({ length: pagesNeeded.pagesNeeded }, (v, i) => i + 1);
          const missingPages = findMissingValues(pagesArray, originalArrayLength);
          console.info("missingPages: ", missingPages);
          lambdaEvent.pendingPages = missingPages;
          tempResponseObject = {};
          if (missingPages.length) {
            const resObject =
              finalLambdaResponse[searchId][
              Object.keys(finalLambdaResponse[searchId])[
              Object.keys(finalLambdaResponse[searchId]).length - 1
              ]
              ]

            lambdaEvent.lastCursorValue = resObject?.lastCursorValue;
            lambdaEvent.nextPageToken = resObject?.nextPageToken;
            console.info("resobject===> ", resObject, Object.keys(finalLambdaResponse[searchId])[Object.keys(finalLambdaResponse[searchId]).length - 1])
            if (resObject.hasOwnProperty('has_more') && resObject.has_more == false) return
            let lambdaResponse = await lambdaFunctionInvoke(lambdaEvent)
          }
          console.info("check finalLambdaRespose.....");
        } else {
          console.log("inside else block and insertDB function  calling");
          insertDB(searchId);
        }
      }
    }
    else {
      // tempResponseObject = {};
      // finalLambdaResponse = {};
      // lambdaEvent.pendingPages = [];
      console.info("lambda Invoke again.....");
      // await lambdaFunctionInvoke(lambdaEvent);
    }

    // if(Object.keys(tempResponseObject).length > 0){
    //   //checking single page data
    //   if(tempResponseObject.hasOwnProperty(searchId)){
    //     if(tempResponseObject[searchId].pageLength != tempResponseObject[searchId].receiveLength){
    //        console.info("call lambda again....");
    //        lambdaEvent.pendingPages = [];
    //        tempResponseObject = {};
    //        const lambdaResponse = await lambdaFunctionInvoke(lambdaEvent);
    //     }
    //   };
    // }
    // const totalPages = assetsNeededPages[searchId].totalPages;
    // const receivedResponsePages = apiData[searchId].results
  } catch (err) {
    // delete apiData[searchId];
    // delete serverStorage[searchId];
    // delete finalLambdaResponse[searchId];
    // delete tempResponseObject[searchId];
    console.error("Error: ", err);
  }
}

io.on("connection", async (socket) => {
  var currentdate = new Date();
  var datetime = "Last Sync: " + currentdate.getDate() + "/"
    + (currentdate.getMonth() + 1) + "/"
    + currentdate.getFullYear() + " @ "
    + currentdate.getHours() + ":"
    + currentdate.getMinutes() + ":"
    + currentdate.getSeconds();
  console.info("A user connected: ", socket.id);
  console.info("socket connect time: ", datetime);
  console.info("socketInterval: ", socketInterval);
  socketInterval = await fetchIntervalDetail();

  socket.emit("cursorInterval", {
    userStatusInterval: socketInterval
  })

  socket.on("disconnect", (reason) => {
    var currentdate = new Date();
    var datetime = "Last Sync: " + currentdate.getDate() + "/"
      + (currentdate.getMonth() + 1) + "/"
      + currentdate.getFullYear() + " @ "
      + currentdate.getHours() + ":"
      + currentdate.getMinutes() + ":"
      + currentdate.getSeconds();
    console.log("reason for disconnecting", reason);
    const lambdaEvent = lambdaSocketIds[socket.id];
    console.info("lambdaEvent: ", lambdaEvent?.searchId);
    if (lambdaEvent?.searchId != undefined) {
      console.info("verifyLambdaResponse function called.......");
      verifyLambdaResponse(lambdaEvent);
    }
    console.log("disconnect time ", datetime);
    delete cursorPositions[socket.id]
    console.log("User disconnected: ", socket.id);
  });

  socket.on("cursorPosition", (data) => {
    console.info("cursorPosition........");
    if (Object.keys(data).length) {
      console.log("data: ", data);
      cursorPositions[socket.id] = data.cursorPosition;
    }

    if (Object.keys(cursorPositions).length) {
      //console.log("cursorPositions: ", cursorPositions);
      socket.emit("cursorBroadcast", {
        cursorPositions
      })
    }

  })

  socket.on("lambdaSocketConnect", (data) => {
    lambdaSocketIds[socket.id] = data.event
  })


  // Listen for the 'sendMessage' event from the client
  socket.on("sendMessage", (data) => {
    console.log("Message received from client:", data);

    // Emit a response event back to the client
    socket.emit("messageReceived", {
      message: "Message received on the server 222!",
    });
  });

  socket.on("unsplashoAuth", async (data) => {
    console.log("Unsplash Event Response");
    console.log(data);
  });

  socket.on("searchEvent", async (event) => {
    console.log("searchEvent: ", event);
    if (event.hasOwnProperty("queryTerm")) {
      const clientParams = {
        ip: process.env.IP || "34.203.199.165",
        port: process.env.PORT || 3005,
        rawPath: event.queryTerm,
      };
      console.log("this is query", event);

      let missingAssets = event.missingAsset;
      let apiCacheResults = await apiSearch(missingAssets, socket);
      console.log("apiCacheResults: ", apiCacheResults);

      return apiCacheResults;
      // await clientSocketLamda(clientParams);
    } else if (event.searchGlobalCache === true) {
      // grab the params from event.searchParams and construct a query for openSearch
      console.info("inside the searchGlobalCache....");
      console.info("event: - ", event);
      let searchParams = event.searchParams;
      let searchParamsKeys = Object.keys(searchParams);

      let searchParamsQuery = "";
      searchParamsKeys.forEach((key) => {
        searchParamsQuery += `${key}=${searchParams[key]}&`;
      });

      // console.log('searchParamsQuery: ', searchParamsQuery);
      let autosearchGlobalCacheResults = await autosearchGlobalCache(
        searchParamsQuery
      );
      socket.emit("searchResults", autosearchGlobalCacheResults);
      // socket.emit('searchEvent', autosearchGlobalCacheResults);
      return autosearchGlobalCache(searchParamsQuery);
    } else {
      let wobbleCacheMode = event.wobbleCacheMode;
      // Initiate the final return object
      let globalCacheResults = {};
      let wobbleCache = {};
      let missingAssets = [];
      let globalCacheAssets = [];
      let suppliedWobbleCacheKey = "";

      if (wobbleCacheMode === "add") {
        // Add to current Wobble Cache
        // console.log('add to current Wobble Cache');
        suppliedWobbleCacheKey = event.wobbleCacheKey;
      } else if (wobbleCacheMode === "replace") {
        // Replace the current Wobble Cache
        // console.log('Replace the current Wobble Cache');
        suppliedWobbleCacheKey = event.wobbleCacheKey;
      } else if (wobbleCacheMode === "new") {
        // Create a new Wobble Cache
        // console.log('Create a new Wobble Cache');
      }

      // Process the payload to understand what we need in return and create the call order for the Global Cache

      let whatWeNeed = await processWobbleCacheRequest(event);

      console.log("whatWeNeed: ", whatWeNeed);

      // Search Global Cache
      globalCacheResults = await searchGlobalCache(whatWeNeed.endpoints, event);
      globalCacheResults.globalCacheAssets = globalCacheResults;
      globalCacheAssets = globalCacheResults.globalCacheAssets;
      missingAssets = globalCacheResults.missingAssets;

      // wobbleCache Object is created here
      wobbleCache.assetsNeeded = whatWeNeed.assetsNeeded;
      wobbleCache.ingredientCount = whatWeNeed.ingredientCount;
      wobbleCache.gridCount = whatWeNeed.gridCount;
      wobbleCache.preWobbleCount = whatWeNeed.preWobbleCount;
      wobbleCache.userId = event.userId;
      wobbleCache.clientId = event.clientId;
      wobbleCache.projectId = event.projectId;
      wobbleCache.activeTasteId = event.activeTasteId;
      wobbleCache.searchId = event._id;

      // we have enough in Global Cache
      if (globalCacheAssets.length >= whatWeNeed.assetsNeeded) {
        wobbleCache.items = globalCacheAssets;
        // console.log('wobbleCache: ', wobbleCache);
        socket.emit("searchResults", wobbleCache);
        const wobbleCacheKey = await sendToMongoWobbleCache(
          wobbleCache,
          wobbleCacheMode,
          suppliedWobbleCacheKey
        );
        socket.emit("wobbleCacheKey", wobbleCacheKey);
        console.log("wobbleCacheKey: ", await wobbleCacheKey);
        return await wobbleCacheKey.insertedId;
      }

      // we don't have enough in Global Cache
      else {
        wobbleCache.items = globalCacheAssets;
        missingAssets.map((obj) => {
          console.log("search id for the serverSotage ", obj.searchId);
          serverStorage[obj.searchId] = {
            wobbleCache,
            wobbleCacheMode,
            suppliedWobbleCacheKey,
            globalCacheAssets,
            clientSocketId: socket.id,
          };
        });


        // console.log("missingAssets 798: ", JSON.stringify(serverStorage));
        // TODO: Send back the global cache results via socket.io asap back to meteor's wobble cache
        let apiCacheResults = await apiSearch(missingAssets, socket);
        // console.log("missingAssets 804: ", JSON.stringify(serverStorage));
        return { status: 200, message: "success" };
        //11-01-24 testing
        // let apiSearchResults = [];
        // apiCacheResults.forEach((apiResult) => {
        //   apiResult.results.forEach((singleResult) => {
        //     const globalCacheItem = {};
        //     globalCacheItem.id =
        //       apiResult.assetVendorId + "-" + singleResult.id;
        //     globalCacheItem.src = singleResult.urls;
        //     globalCacheItem.keywords = singleResult.tags;
        //     globalCacheItem.content = singleResult;
        //     globalCacheItem.userId = event.userId;
        //     globalCacheItem.searchId = event.searchId;
        //     globalCacheItem.ingredientId = apiResult.ingredientId;
        //     globalCacheItem.ingredientName = apiResult.ingredientName;
        //     globalCacheItem.ingredientType = apiResult.ingredientType;
        //     globalCacheItem.assetVendorId = apiResult.assetVendorId;
        //     globalCacheItem.vendorEndpointId = apiResult.vendorEndpointId;
        //     // if it's a source image, we need to get the first url
        //     if (apiResult.vendorEndpointId === "clcaxnyytj0o50ak472r3y299") {
        //       globalCacheItem.src = singleResult.urls.regular;
        //     } else if (
        //       apiResult.vendorEndpointId === "clcecey82qevd0ake6o2v1id2"
        //     ) {
        //       console.log("singleResult", singleResult.previews.live_site);
        //       globalCacheItem.src = singleResult?.previews?.live_site?.url;
        //     }
        //     console.log("globalCacheItem", globalCacheItem);
        //     apiSearchResults.push(globalCacheItem);
        //   });
        //   // socket.emit('searchResults', apiResult);
        // });
        // wobbleCache.items = globalCacheAssets.concat(apiSearchResults);
        // socket.emit("searchResults", wobbleCache);
        // const wobbleCacheKey = await sendToMongoWobbleCache(
        //   wobbleCache,
        //   wobbleCacheMode,
        //   suppliedWobbleCacheKey
        // );
        // socket.emit("wobbleCacheKey", wobbleCacheKey);
        // console.log("sending to Global Cache");

        // Promise.resolve(sendToOpenSearchGlobalCache(apiSearchResults)).catch(
        //   (error) => {
        //     console.error(
        //       "Error sending data to OpenSearch Global Cache:",
        //       error
        //     );
        //   }
        // );
        // // socket.emit('wobbleCacheKey', wobbleCacheKey);
        // console.log("wobbleCacheKey:1 ", wobbleCacheKey);
        // return wobbleCacheKey.insertedId;
        //11-01-24 testing
      }
      return wobbleCacheKey.insertedId;
      console.log("saved to GlobalCache");
    }
  });
  let counterData = 0;
  socket.on("lambdaResponse", async (data) => {
    counterData++;
    console.log("==================================================");
    console.log("Lambda Response called..............!")
    console.info("lambdaResponse count: ", counterData);
    const searchId = Object.keys(data)[0];
    console.info("pageNumber: ", data.pageNumber);
    console.info("searchId : ", searchId);
    if (tempResponseObject.hasOwnProperty(searchId)) {
      console.log("In if condition in lambdaResponse....!");
      let isPageNumberExist = tempResponseObject[searchId].results.hasOwnProperty(data?.pageNumber);
      tempResponseObject[searchId].results[data.pageNumber] = (isPageNumberExist ? tempResponseObject[searchId].results[data.pageNumber].concat(data[searchId]) : data[searchId]);
      tempResponseObject[searchId].supplied =
        tempResponseObject[searchId].supplied + (data[searchId].supplied != undefined)
          ? data[searchId].supplied
          : 0;
      tempResponseObject[searchId].pageLength = data.pageLength;
      tempResponseObject[searchId].receiveLength = counterData;
      tempResponseObject[searchId].pagesNeeded = data.pagesNeeded;
      tempResponseObject[searchId].lastCursorValue = data.lastCursorValue;
      tempResponseObject[searchId].has_more = data.has_more;
      tempResponseObject[searchId].nextPageToken = data.nextPageToken;
    } else {
      console.log("In else condition in lambdaResponse....!");
      tempResponseObject[searchId] = {};
      tempResponseObject[searchId] = data["dataPayload"];
      tempResponseObject[searchId].results = {}
      tempResponseObject[searchId].results[data.pageNumber] = data[searchId]
      tempResponseObject[searchId].supplied = data.supplied
      tempResponseObject[searchId].pageLength = data.pageLength;
      tempResponseObject[searchId].receiveLength = counterData;
      tempResponseObject[searchId].pagesNeeded = data.pagesNeeded;
      tempResponseObject[searchId].lastCursorValue = data.lastCursorValue
      tempResponseObject[searchId].has_more = data.has_more
      tempResponseObject[searchId].nextPageToken = data.nextPageToken;
    }
  });

  socket.on('updateHasMore', data => {
    console.info("Data====> ", data)
    if (finalLambdaResponse.hasOwnProperty(data.searchId)) {
      const keyName = Object.keys(finalLambdaResponse[data.searchId])[
        Object.keys(finalLambdaResponse[data.searchId]).length - 1
      ]
      console.info(
        'updateHasMore ===> ',
        data,
        keyName,
        finalLambdaResponse[data.searchId][keyName]
      )
      finalLambdaResponse[data.searchId][keyName].has_more = data.has_more
    }
  })

  socket.on("finalResponse", (data) => {
    console.info("final response searchId : ", data?.searchId);
    const objectKey = Object.keys(tempResponseObject[data?.searchId].results)
    console.info("objectKey: ", objectKey);
    console.info("pageIndex: ", objectKey[0]);
    if (finalLambdaResponse.hasOwnProperty(data.searchId)) {
      finalLambdaResponse[data?.searchId][objectKey[0]] = tempResponseObject[data?.searchId];
    } else {
      finalLambdaResponse[data?.searchId] = {}
      finalLambdaResponse[data?.searchId][objectKey[0]] = tempResponseObject[data?.searchId];
    }
    console.info("finalLambdaResponse: ");
    //console.log("tempResponseObject[data?.searchId].results -----> : ", tempResponseObject[data?.searchId].results);
    //console.log("Object.values(tempResponseObject[data?.searchId].results) : " , Object.values(tempResponseObject[data?.searchId].results));
    console.log("======> : ", (Object.values(tempResponseObject[data?.searchId].results))[0].length);
    io.to(serverStorage[data?.searchId].clientSocketId).emit(
      "pageDetails",
      { "page": 1, "totalPage": tempResponseObject[data?.searchId].pagesNeeded, "size": (Object.values(tempResponseObject[data?.searchId].results))[0].length, functionName: data?.functionName, "data": tempResponseObject[data?.searchId] }
    );
    counterData = 0;
    tempResponseObject = {};
  });

  async function openSearchforautoSearch(data, index) {
    console.log("data in opensearchforautosearch-->", data)
    const searchQuery = data.payload.assetsNeeded[0].components[0].properties[0].locks[0].text;
    const userId = data.payload.userId;
    const assetVendorId = data.payload.assetsNeeded[0].assetVendors[0].id;
    console.log("userId", userId);
    console.log("assetVendorId", assetVendorId);
    console.log("searchQuery--->", searchQuery);

    const response = await clientOpensearch.search({
      index: index,
      body: {
        size: 5,
        _source: ["content.image_urls"],
        query: {
          bool: {
            must: [
              {
                match: {
                  userId: "bJtbrTvLXwimCEZki"
                }
              },
              {
                match: {
                  assetVendorId: "clcawue99ijj90biq8ya1r76b"
                }
              },
              {
                multi_match: {
                  query: "2f73991c3b328dc58f92dc34908e3ba1",
                  fields: ["*"]
                }
              }
            ]
          }
        }
      },
    });
    console.log("response in openSearchforautoSearch=======>", response);
    console.log("response in openSearchforautoSearch=======>", JSON.stringify(response.body.hits.hits));
    // return response;
  }
  socket.on("autoComplete", async (data) => {
    console.info("autoComplete ====== ", data.payload);
    const index = 'globalcache';
    const openSearchResponse = openSearchforautoSearch(data, index);
    console.log("openSearchResponse-=-=-=-=-=>", openSearchResponse);
    const command = new InvokeCommand({
      FunctionName: 'arn:aws:lambda:us-east-1:883581233691:function:wobbleAutoSearch-staging',
      InvocationType: "RequestResponse",
      Payload: JSON.stringify(data),
    });
    console.info("command=>>", command)
    lambda
      .send(command)
      .then(async (data) => {
        console.info("Then", data)
        const responseBuffer = Buffer.from(data.Payload);
        let resultData = await JSON.parse(responseBuffer.toString("utf8"));
        console.log("resultData------------->", resultData);
        socket.emit("autoComplete", { results: resultData })
      })
      .catch((err) => {
        console.error("Error in the autoComplete topic", err);
        socket.emit("autoComplete", { results: [] })
      });
  })
});

const PORT = process.env.PORT || 3005;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
