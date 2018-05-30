// omg I am tired of code

const { getPlayer } = require('./players')
const { getDownloaderFor } = require('./downloaders')
const { AppElement } = require('./ui')
const ansi = require('./tui-lib/util/ansi')
const CommandLineInterfacer = require('./tui-lib/util/CommandLineInterfacer')
const EventEmitter = require('events')
const Flushable = require('./tui-lib/util/Flushable')
const Root = require('./tui-lib/ui/Root')

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

  /*
  await internalApp.startPlaying('http://billwurtz.com/cable-television.mp3')
  await new Promise(r => setTimeout(r, 2000))
  internalApp.togglePause()
  await new Promise(r => setTimeout(r, 1000))
  internalApp.togglePause()
  await new Promise(r => setTimeout(r, 2000))
  internalApp.stopPlaying()
  */

  /*
  for (const item of require('./flat.json').items) {
    await internalApp.download(item.downloaderArg)
  }
  */

  const interfacer = new CommandLineInterfacer()
  const size = await interfacer.getScreenSize()

  const flushable = new Flushable(process.stdout, true)
  flushable.screenLines = size.lines
  flushable.screenCols = size.cols
  flushable.shouldShowCompressionStatistics = process.argv.includes('--show-ansi-stats')
  flushable.write(ansi.clearScreen())
  flushable.flush()

  const root = new Root(interfacer)
  root.w = size.width
  root.h = size.height

  const appElement = new AppElement()
  root.addChild(appElement)
  root.select(appElement)

  appElement.on('quitRequested', () => {
    process.stdout.write(ansi.cleanCursor())
    process.exit(0)
  })

  const grouplike = {
    items: [
      {name: 'Nice'},
      {name: 'W00T!'},
      {name: 'All-star'}
    ]
  }

  appElement.recordStore.getRecord(grouplike.items[2]).downloading = true

  appElement.grouplikeListingElement.loadGrouplike(grouplike)

  root.select(appElement.grouplikeListingElement)

  setInterval(() => {
    root.renderTo(flushable)
    flushable.flush()
  }, 50)
}

main().catch(err => console.error(err))
