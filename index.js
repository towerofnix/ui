// omg I am tired of code

const { getPlayer } = require('./players')
const { getDownloaderFor } = require('./downloaders')
const { AppElement } = require('./ui')
const { updatePlaylistFormat } = require('./playlist-utils')
const ansi = require('./tui-lib/util/ansi')
const CommandLineInterfacer = require('./tui-lib/util/CommandLineInterfacer')
const EventEmitter = require('events')
const Flushable = require('./tui-lib/util/Flushable')
const Root = require('./tui-lib/ui/Root')

process.on('unhandledRejection', error => {
  console.error(error.stack)
  process.exit(1)
})

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
  /*
  const internalApp = new InternalApp()
  await internalApp.setup()

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

  await appElement.setup()

  appElement.on('quitRequested', () => {
    process.stdout.write(ansi.cleanCursor())
    process.exit(0)
  })

  let grouplike = {
    items: [
      {name: 'bears', downloaderArg: 'http://www.billwurtz.com/bears.mp3'},
      {name: 'alphabet shuffle', downloaderArg: 'http://www.billwurtz.com/alphabet-shuffle.mp3'},
      {name: 'in california', downloaderArg: 'http://www.billwurtz.com/in-california.mp3'},
      {name: 'i love you', downloaderArg: 'http://www.billwurtz.com/i-love-you.mp3'},
      {name: 'movie star', downloaderArg: 'http://www.billwurtz.com/movie-star.mp3'},
      {name: 'got to know what\'s going on', downloaderArg: 'http://www.billwurtz.com/got-to-know-whats-going-on.mp3'},
      {name: 'outside', downloaderArg: 'http://www.billwurtz.com/outside.mp3'},
      {name: 'La de da de da de da de day oh', downloaderArg: 'http://www.billwurtz.com/la-de-da-de-da-de-da-de-day-oh.mp3'},
      {name: 'and the day goes on', downloaderArg: 'http://www.billwurtz.com/and-the-day-goes-on.mp3'}
    ]
  }

  // let grouplike = require('./flat.json')

  grouplike = updatePlaylistFormat(grouplike)

  appElement.grouplikeListingElement.loadGrouplike(grouplike)

  root.select(appElement.grouplikeListingElement)

  setInterval(() => {
    root.renderTo(flushable)
    flushable.flush()
  }, 50)
}

main().catch(err => console.error(err))
