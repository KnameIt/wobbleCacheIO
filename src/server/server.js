const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const server = http.createServer();
const io = socketIO(server);

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
});

const PORT = process.env.PORT || 3005;

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});