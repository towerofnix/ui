// omg I am tired of code

const { AppElement } = require('./ui')
const { updatePlaylistFormat } = require('./playlist-utils')
const processSmartPlaylist = require('./smart-playlist')
const ansi = require('./tui-lib/util/ansi')
const CommandLineInterfacer = require('./tui-lib/util/CommandLineInterfacer')
const EventEmitter = require('events')
const Flushable = require('./tui-lib/util/Flushable')
const Root = require('./tui-lib/ui/Root')

// Hack to get around errors when piping many things to stdout/err
// (from general-util promisifyProcess)
process.stdout.setMaxListeners(Infinity)
process.stderr.setMaxListeners(Infinity)

process.on('unhandledRejection', error => {
  console.error(error.stack)
  process.exit(1)
})

async function main() {
  const interfacer = new CommandLineInterfacer()
  const size = await interfacer.getScreenSize()

  const flushable = new Flushable(process.stdout, true)
  flushable.resizeScreen(size)
  flushable.shouldShowCompressionStatistics = process.argv.includes('--show-ansi-stats')
  flushable.write(ansi.clearScreen())
  flushable.flush()

  const root = new Root(interfacer)
  root.w = size.width
  root.h = size.height

  interfacer.on('resize', newSize => {
    root.w = newSize.width
    root.h = newSize.height
    flushable.resizeScreen(newSize)
    root.fixAllLayout()
  })

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

  if (process.argv[2]) {
    flushable.write(ansi.moveCursor(0, 0))
    flushable.write('Opening playlist...')
    flushable.flush()
    grouplike = require(process.argv[2])
  }

  grouplike = await processSmartPlaylist(grouplike)

  appElement.grouplikeListingElement.loadGrouplike(grouplike)

  root.select(appElement.form)

  setInterval(() => {
    root.renderTo(flushable)
    flushable.flush()
  }, 50)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
