import * as WebSocket from 'ws'

import BlockChain from './blockchain'

enum MessageType {
  QUERY_LATEST,
  QUERY_ALL,
  RESPONSE_BLOCKCHAIN
}

export enum BroadcastType {
  ResponseLatestMsg
}

export default class Socket {
  private _ws: WebSocket
  private _blockChain: BlockChain
  private _queryChainLengthMsg: object = { type: MessageType.QUERY_LATEST }
  private _queryAllMsg: object = { type: MessageType.QUERY_ALL }
  private _broadcast: any

  constructor(ws: WebSocket, broadcast: any, blockchain: BlockChain) {
    this._ws = ws
    this._blockChain = blockchain
    this._broadcast = broadcast
    this._initMessageHandler()
    this.write(this._queryChainLengthMsg)
  }

  public get websocket(): WebSocket {
    return this._ws
  }

  public broadcast(type: BroadcastType): void {
    switch (type) {
      case BroadcastType.ResponseLatestMsg:
        return this._broadcast(this._responseLatestMsg)
    }
  }

  public write(message: object): void {
    this._ws.send(JSON.stringify(message))
  }

  private get _responseLatestMsg(): object {
    return  {
      type: MessageType.RESPONSE_BLOCKCHAIN,
      data: JSON.stringify([this._blockChain.latestBlock])
    }
  }
  private get _responseChainMsg(): object {
    return {
      type: MessageType.RESPONSE_BLOCKCHAIN,
      data: JSON.stringify(this._blockChain.blocks)
    }
  }

  private _initMessageHandler(): void {
    this._ws.on('message', (data: string) => {
      const message = JSON.parse(data)
      console.log('Recieved message: ' + JSON.stringify(message))
      switch (message.type) {
        case MessageType.QUERY_LATEST:
          this.write(this._responseLatestMsg)
          break
        case MessageType.QUERY_ALL:
          this.write(this._responseChainMsg)
          break
        case MessageType.RESPONSE_BLOCKCHAIN:
          this._handleBlockChainResponse(message)
          break
      }
    })
  }

  private _handleBlockChainResponse(message) {
    const receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index))
    const latestBlockReceived = receivedBlocks[receivedBlocks.length - 1]
    const latestBlockHeld = this._blockChain.latestBlock
    if (latestBlockReceived.index > latestBlockHeld.index) {
      // tslint:disable-next-line:max-line-length
      console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index)
      if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
          console.log('We can append the received block to our chain')
          this._blockChain.addBlock(latestBlockReceived)
          this._broadcast(this._responseLatestMsg)
      } else if (receivedBlocks.length === 1) {
          console.log('We have to query the chain from our peer')
          this._broadcast(this._queryAllMsg)
      } else {
          console.log('Received blockchain is longer than current blockchain')
          if (this._blockChain.replaceChain(receivedBlocks)) {
            this._broadcast(this._responseLatestMsg)
          }
      }
    } else {
        console.log('received blockchain is not longer than received blockchain. Do nothing')
    }
  }
}
