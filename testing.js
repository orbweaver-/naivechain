"use strict";
exports.__esModule = true;
var path = require("path");
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require("body-parser");
var WebSocket = require("ws");
var lodash_1 = require("lodash");
var httpPort = process.env.HTTP_PORT || 3001;
var p2pPort = parseInt(process.env.P2P_PORT, 0) || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
var MessageType;
(function (MessageType) {
    MessageType[MessageType["QUERY_LATEST"] = 0] = "QUERY_LATEST";
    MessageType[MessageType["QUERY_ALL"] = 1] = "QUERY_ALL";
    MessageType[MessageType["RESPONSE_BLOCKCHAIN"] = 2] = "RESPONSE_BLOCKCHAIN";
})(MessageType || (MessageType = {}));
var Block = /** @class */ (function () {
    function Block(index, previousHash, timestamp, data, hash) {
        this.index = index;
        this.previousHash = previousHash;
        this.timeStamp = timestamp;
        this.data = data;
        this.hash = typeof hash === 'string' ? hash : hash.toSring();
    }
    return Block;
}());
var getGenesisBlock = function () { return new Block(0, '0', 1465154705, 'my genisis block!!!', '816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7'); };
var sockets = [];
var blockchain = [getGenesisBlock()];
function initHttpServer() {
    var app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded());
    app.engine('ejs', require('ejs').renderFile);
    app.set('views', path.resolve(__dirname, 'client'));
    app.set('views engine', 'ejs');
    app.get('/', function (req, res) { return res.render('index.ejs', {
        blocks: blockchain
    }); });
    app.get('/blocks', function (req, res) { return res.send(JSON.stringify(blockchain)); });
    app.post('/mine-block', function (req, res) {
        if (!req.body.data || req.body.data.length === 0) {
            return res.redirect('/');
        }
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        res.redirect('/');
    });
    app.get('/peers', function (req, res) {
        return res.send(sockets.map(function (_a) {
            var _socket = _a._socket;
            return _socket.remoteAddress + ": " + _socket.remotePort;
        }));
    });
    app.post('/add-peer', function (_a, res) {
        var body = _a.body;
        if (!body.peer || body.peer.length === 0) {
            return res.redirect('/');
        }
        connectToPeers([body.peer]);
        res.redirect('/');
    });
    app.listen(httpPort, function () { return console.log('Listening http on port ' + httpPort); });
}
function initP2PServer() {
    var server = new WebSocket.Server({ port: p2pPort });
    server.on('connection', function (ws) { return initConnection(ws); });
    console.log('Listening websocket p2p port on: ' + p2pPort);
}
function initConnection(ws) {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
}
function initMessageHandler(ws) {
    ws.on('message', function (data) {
        var message = JSON.parse(data);
        console.log('Recieved message: ' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockChainResponse(message);
                break;
        }
    });
}
function initErrorHandler(ws) {
    var closeConnection = function (socket) {
        console.log('connection failed to peer: ' + socket.url);
        sockets.splice(sockets.indexOf(socket), 1);
    };
    ws.on('close', function () { return closeConnection(ws); });
    ws.on('error', function () { return closeConnection(ws); });
}
function generateNextBlock(blockData) {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimeStamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimeStamp, blockData);
    return new Block(nextIndex, previousBlock.hash, nextTimeStamp, blockData, nextHash);
}
function calculateHashForBlock(block) {
    return calculateHash(block.index, block.previousHash, block.timeStamp, block.data);
}
function calculateHash(index, previousHash, timeStamp, data) {
    return CryptoJS.SHA256(index + previousHash + timeStamp + data).toString();
}
function addBlock(newBlock) {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
}
function isValidNewBlock(newBlock, previousBlock) {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    }
    else if (previousBlock.hash !== newBlock.hash) {
        console.log('invalid hash');
        return false;
    }
    else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
}
function connectToPeers(newPeers) {
    lodash_1.each(newPeers, function (peer) {
        var ws = new WebSocket(peer);
        ws.on('open', function () { return initConnection(ws); });
        ws.on('error', function () { return console.log('Connection failed'); });
    });
}
function handleBlockChainResponse(message) {
    var receivedBlocks = JSON.parse(message.data).sort(function (b1, b2) { return (b1.index - b2.index); });
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        // tslint:disable-next-line:max-line-length
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log('We can append the received block to our chain');
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        }
        else if (receivedBlocks.length === 1) {
            console.log('We have to query the chain from our peer');
            broadcast(queryAllMsg());
        }
        else {
            console.log('Received blockchain is longer than current blockchain');
            replaceChain(receivedBlocks);
        }
    }
    else {
        console.log('received blockchain is not longer than received blockchain. Do nothing');
    }
}
function replaceChain(newBlocks) {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    }
    else {
        console.log('Received blockchain invalid');
    }
}
function isValidChain(blockchainToValidate) {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        }
        else {
            return false;
        }
    }
    return true;
}
var getLatestBlock = function () { return blockchain[blockchain.length - 1]; };
var queryChainLengthMsg = function () { return ({ type: MessageType.QUERY_LATEST }); };
var queryAllMsg = function () { return ({ type: MessageType.QUERY_ALL }); };
var responseChainMsg = function () { return ({
    type: MessageType.RESPONSE_BLOCKCHAIN, data: JSON.stringify(blockchain)
}); };
var responseLatestMsg = function () { return ({
    type: MessageType.RESPONSE_BLOCKCHAIN,
    data: JSON.stringify([getLatestBlock()])
}); };
var write = function (ws, message) { return ws.send(JSON.stringify(message)); };
var broadcast = function (message) { return lodash_1.each(sockets, function (socket) { return write(socket, message); }); };
connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
