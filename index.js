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

  stopPlaying() {
    this.player.kill()
  }

  seekAhead(seconds) {
    this.player.seekAhead(seconds)
  }

  seekBehind(seconds) {
    this.player.seekBehind(seconds)
  }

  togglePause() {
    this.player.togglePause()
  }

  download(arg) {
    return getDownloaderFor(arg)(arg)
  }
}

async function main() {
  const internalApp = new InternalApp()
  await internalApp.setup()
  await internalApp.startPlaying('http://billwurtz.com/cable-television.mp3')
  await new Promise(r => setTimeout(r, 2000))
  internalApp.togglePause()
  await new Promise(r => setTimeout(r, 1000))
  internalApp.togglePause()
  await new Promise(r => setTimeout(r, 2000))
  internalApp.stopPlaying()
}

main().catch(err => console.error(err))
