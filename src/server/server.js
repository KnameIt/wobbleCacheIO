const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const server = http.createServer();
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
});

// app.use(cors());

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });

    // Listen for the 'sendMessage' event from the client
    socket.on('sendMessage', (data) => {
        console.log('Message received from client:', data);

        // Emit a response event back to the client
        socket.emit('messageReceived', { message: 'Message received on the server!' });
    });


    socket.on('searchEvent', async (searchParams) => {
        try {
          // Call the function that handles the search logic (e.g., autosearchGlobalCache)
          const searchResults = await autosearchGlobalCache(searchParams.query);
          // Process results, store to MongoDB and global cache
          await processAndStoreResults(searchResults);
          // Emit results back to the client
          socket.emit('searchResults', searchResults);
        } catch (error) {
          console.error('Search Error:', error);
          socket.emit('error', error.message);
        }
      });
});

const PORT = process.env.PORT || 3005;

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});