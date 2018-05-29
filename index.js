// omg I am tired of code

const { getPlayer } = require('./players')
const { getDownloaderFor } = require('./downloaders')
const EventEmitter = require('events')

class InternalApp extends EventEmitter {
  download(arg) {
    return getDownloaderFor(arg)(arg)
  }
}

async function main() {
  const internalApp = new InternalApp()
  const player = await getPlayer()
  player.playFile(await internalApp.download('http://billwurtz.com/cable-television.mp3'))
}

main().catch(err => console.error(err))
