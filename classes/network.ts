import * as WebSocket from 'ws'
import { each, map } from 'lodash'

import Socket from './socket'
import BlockChain from './blockchain'

export default class Network {
  private _server: WebSocket.Server
  private _sockets: Socket[]
  private _blockChain: BlockChain

  constructor(p2pPort: number = 6001, blockchain: BlockChain, startingPeers: string[] = []) {
    this._blockChain = blockchain
    this.connectToPeers(startingPeers)
    this._server = new WebSocket.Server({ port: p2pPort })
    this._server.on('connection', (ws) => this.addSocket(ws))
    console.log('Listening websocket p2p port on: ' + p2pPort)
  }

  public get sockets(): WebSocket[] {
    return map(this._sockets, (s) => s.websocket)
  }

  public connectToPeers(peers: string[]): void {
    each(peers, (peer) => {
      const ws = new WebSocket(peer)
      ws.on('open', () => this.addSocket(ws))
      ws.on('error', () => console.log('Connection failed'))
    })
  }

  public broadcast(message): void {
    each(this._sockets, (socket) => socket.write(message))
  }

  private addSocket(ws: WebSocket): Socket {
    const closeConnection = (s) => {
      console.log('connection failed to peer: ' + s.url)
      this._sockets.splice(this._sockets.indexOf(s), 1)
    }

    const socket = new Socket(ws, this.broadcast, this._blockChain)

    ws.on('close', () => closeConnection(socket))
    ws.on('error', () => closeConnection(socket))

    this._sockets.push(socket)
    return socket
  }
}
