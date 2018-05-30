const { getDownloaderFor } = require('./downloaders')
const { getPlayer } = require('./players')
const { parentSymbol } = require('./playlist-utils')
const ansi = require('./tui-lib/util/ansi')
const Button = require('./tui-lib/ui/form/Button')
const FocusElement = require('./tui-lib/ui/form/FocusElement')
const ListScrollForm = require('./tui-lib/ui/form/ListScrollForm')
const Pane = require('./tui-lib/ui/Pane')
const RecordStore = require('./record-store')
const telc = require('./tui-lib/util/telchars')

class AppElement extends FocusElement {
  constructor() {
    super()

    this.player = null
    this.recordStore = new RecordStore()

    this.pane = new Pane()
    this.addChild(this.pane)

    this.grouplikeListingElement = new GrouplikeListingElement(this.recordStore)
    this.pane.addChild(this.grouplikeListingElement)

    this.grouplikeListingElement.on('download', item => this.downloadGrouplikeItem(item))
    this.grouplikeListingElement.on('play', item => this.playGrouplikeItem(item))
  }

  async setup() {
    this.player = await getPlayer()
  }

  async shutdown() {
    await this.player.kill()
    this.emit('quitRequested')
  }

  fixLayout() {
    this.w = this.parent.contentW
    this.h = this.parent.contentH

    this.pane.w = this.contentW
    this.pane.h = this.contentH

    this.grouplikeListingElement.w = this.pane.contentW
    this.grouplikeListingElement.h = this.pane.contentH
  }

  keyPressed(keyBuf) {
    if (keyBuf[0] === 0x03 || keyBuf[0] === 'q'.charCodeAt(0) || keyBuf[0] === 'Q'.charCodeAt(0)) {
      this.shutdown()
      return
    }

    super.keyPressed(keyBuf)
  }

  async downloadGrouplikeItem(item) {
    // TODO: Check if it's an item or a group
    const arg = item.downloaderArg
    this.recordStore.getRecord(item).downloading = true
    try {
      return await getDownloaderFor(arg)(arg)
    } finally {
      this.recordStore.getRecord(item).downloading = false
    }
  }

  async playGrouplikeItem(item) {
    if (this.player === null) {
      throw new Error('Attempted to play before a player was loaded')
    }

    let playingThisTrack = true
    this.emit('playing new track')
    this.once('playing new track', () => {
      playingThisTrack = false
    })

    // TODO: Check if it's an item or a group

    const downloadFile = await this.downloadGrouplikeItem(item)
    await this.player.kill()
    this.recordStore.getRecord(item).playing = true
    try {
      await this.player.playFile(downloadFile)
    } finally {
      this.recordStore.getRecord(item).playing = false
    }

    // playingThisTrack now means whether the track played through to the end
    // (true), or was stopped by a different track being started (false).

    if (playingThisTrack) {
      this.playNextTrack(item)
    }
  }

  playNextTrack(track) {
    const parent = track[parentSymbol]
    if (!parent) {
      return
    }
    const index = parent.items.indexOf(track)
    const nextItem = parent.items[index + 1]
    if (nextItem) {
      this.playGrouplikeItem(nextItem)
    }
  }
}

class GrouplikeListingElement extends ListScrollForm {
  constructor(recordStore) {
    super('vertical')

    this.grouplike = null
    this.recordStore = recordStore
  }

  loadGrouplike(grouplike) {
    this.grouplike = grouplike
    this.buildItems()
  }

  buildItems() {
    if (!this.grouplike) {
      throw new Error('Attempted to call buildItems before a grouplike was loaded')
    }

    for (const item of this.grouplike.items) {
      const itemElement = new GrouplikeItemElement(item, this.recordStore)
      itemElement.on('download', () => this.emit('download', item))
      itemElement.on('play', () => this.emit('play', item))
      this.addInput(itemElement)
    }

    this.fixLayout()
  }
}

class GrouplikeItemElement extends Button {
  constructor(item, recordStore) {
    super()

    this.item = item
    this.recordStore = recordStore
  }

  fixLayout() {
    this.w = this.parent.contentW
    this.h = 1
  }

  drawTo(writable) {
    if (this.isFocused) {
      writable.write(ansi.invert())
    }

    writable.write(ansi.moveCursor(this.absTop, this.absLeft))
    this.drawX = this.x
    this.writeStatus(writable)
    this.drawX += this.item.name.length
    writable.write(this.item.name)
    writable.write(' '.repeat(this.w - this.drawX))

    writable.write(ansi.resetAttributes())
  }

  writeStatus(writable) {
    this.drawX += 3

    const braille = '⠈⠐⠠⠄⠂⠁'
    const brailleChar = braille[Math.floor(Date.now() / 250) % 6]

    const record = this.recordStore.getRecord(this.item)

    writable.write(' ')
    if (record.downloading) {
      writable.write(braille[Math.floor(Date.now() / 250) % 6])
    } else if (record.playing) {
      writable.write('\u25B6')
    } else {
      writable.write(' ')
    }
    writable.write(' ')
  }

  keyPressed(keyBuf) {
    // TODO: Helper function for this
    if (keyBuf[0] === 'd'.charCodeAt(0) || keyBuf[0] === 'D'.charCodeAt(0)) {
      this.emit('download')
    }

    if (telc.isSelect(keyBuf)) {
      this.emit('play')
    }
  }
}

module.exports.AppElement = AppElement
