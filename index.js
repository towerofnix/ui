// omg I am tired of code

const { getPlayer } = require('./players')
const { getDownloaderFor } = require('./downloaders')
const EventEmitter = require('events')

class InternalApp extends EventEmitter {
  constructor() {
    super()
    this.player = null
  }

  async setup() {
    this.player = await getPlayer()
  }

  async startPlaying(arg) {
    this.player.playFile(await this.download(arg))
  }

  download(arg) {
    return getDownloaderFor(arg)(arg)
  }
}

async function main() {
  const internalApp = new InternalApp()
  await internalApp.setup()
  internalApp.startPlaying('http://billwurtz.com/cable-television.mp3')
}

main().catch(err => console.error(err))
