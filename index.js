// omg I am tired of code

const { getPlayer } = require('./players')
const { getDownloaderFor } = require('./downloaders')
const EventEmitter = require('events')

class InternalApp extends EventEmitter {
  constructor() {
    super()

    // downloadCache [downloaderFunction] [downloaderArg]
    this.downloadCache = new Map()
  }

  async download(arg) {
    const downloader = getDownloaderFor(arg)
    if (this.downloadCache.has(downloader)) {
      const category = this.downloadCache.get(downloader)
      if (category.hasOwnProperty(arg)) {
        return category[arg]
      }
    }

    const ret = await this.downloadIgnoringCache(arg)

    if (!this.downloadCache.has(downloader)) {
      this.downloadCache.set(downloader, {})
    }

    this.downloadCache.get(downloader)[arg] = ret

    return ret
  }

  downloadIgnoringCache(arg) {
    const downloader = getDownloaderFor(arg)
    return downloader(arg)
  }
}

async function main() {
  const internalApp = new InternalApp()
  const player = await getPlayer()
  player.playFile(await internalApp.download('http://billwurtz.com/cable-television.mp3'))
}

main().catch(err => console.error(err))
