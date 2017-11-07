import Block from './block'
import { each } from 'lodash'

export default class BlockChain {
  public static isValidChain(blockchainToValidate: Block[]): boolean {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(BlockChain.genesisBlock)) {
      return false
    }
    const tempBlocks = [blockchainToValidate[0]]
    for (let i = 1; i < blockchainToValidate.length; i++) {
        if (Block.isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i])
        } else {
            return false
        }
    }
    return true
  }

  public static get genesisBlock(): Block {
    return new Block(
      0,
      'my genisis block!!!',
      '0',
      1465154705,
      '816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7'
    )
  }

  private _blocks: Block[]

  constructor(initialBlocks: Block[] = null) {
    this._blocks = initialBlocks && BlockChain.isValidChain(initialBlocks)
      ? initialBlocks
      : [BlockChain.genesisBlock]
  }

  public get blocks(): Block[] {
    return this._blocks
  }

  public get latestBlock(): Block {
    return this._blocks[this._blocks.length - 1]
  }

  public add(data: string): Block {
    const newBlock = Block.fromBlock(data, this.latestBlock)
    this._blocks.push(newBlock)
    return newBlock
  }

  public addBlock(block: Block): Block {
     this._blocks.push(block)
     return block
  }

  public replaceChain(newBlocks): boolean {
    if (BlockChain.isValidChain(newBlocks) && newBlocks.length > this._blocks.length) {
      console.log('Received blockchain is valid. Replacing current blockchain with received blockchain')
      this._blocks = newBlocks
      return true
    } else {
      console.log('Received blockchain invalid')
      return false
    }
  }
}
