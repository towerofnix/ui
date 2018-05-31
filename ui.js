const { getDownloaderFor } = require('./downloaders')
const { getPlayer } = require('./players')
const { parentSymbol } = require('./playlist-utils')
const ansi = require('./tui-lib/util/ansi')
const Button = require('./tui-lib/ui/form/Button')
const FocusElement = require('./tui-lib/ui/form/FocusElement')
const Form = require('./tui-lib/ui/form/Form')
const ListScrollForm = require('./tui-lib/ui/form/ListScrollForm')
const Pane = require('./tui-lib/ui/Pane')
const RecordStore = require('./record-store')
const telc = require('./tui-lib/util/telchars')

class AppElement extends FocusElement {
  constructor() {
    super()

    this.player = null
    this.recordStore = new RecordStore()

    this.form = new Form()
    this.addChild(this.form)

    this.paneLeft = new Pane()
    this.form.addChild(this.paneLeft)

    this.paneRight = new Pane()
    this.form.addChild(this.paneRight)

    this.grouplikeListingElement = new GrouplikeListingElement(this.recordStore)
    this.paneLeft.addChild(this.grouplikeListingElement)
    this.form.addInput(this.grouplikeListingElement, false)

    this.grouplikeListingElement.on('download', item => this.downloadGrouplikeItem(item))
    this.grouplikeListingElement.on('select', item => this.queueGrouplikeItem(item))

    this.queueGrouplike = {items: []}

    this.queueListingElement = new GrouplikeListingElement(this.recordStore)
    this.queueListingElement.loadGrouplike(this.queueGrouplike)
    this.paneRight.addChild(this.queueListingElement)
    this.form.addInput(this.queueListingElement, false)

    this.queueListingElement.on('select', item => this.playGrouplikeItem(item))
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

    this.paneLeft.w = Math.max(Math.floor(0.8 * this.contentW), this.contentW - 80)
    this.paneLeft.h = this.contentH
    this.paneRight.x = this.paneLeft.right
    this.paneRight.w = this.contentW - this.paneLeft.right
    this.paneRight.h = this.contentH

    this.grouplikeListingElement.w = this.paneLeft.contentW
    this.grouplikeListingElement.h = this.paneLeft.contentH

    this.queueListingElement.w = this.paneRight.contentW
    this.queueListingElement.h = this.paneRight.contentH
  }

  keyPressed(keyBuf) {
    if (keyBuf[0] === 0x03 || telc.isCaselessLetter(keyBuf, 'q')) {
      this.shutdown()
      return
    }

    if (telc.isRight(keyBuf) || telc.isCaselessLetter(keyBuf, 'l')) {
      this.seekAhead(10)
    } else if (telc.isLeft(keyBuf) || telc.isCaselessLetter(keyBuf, 'j')) {
      this.seekBack(10)
    } else if (telc.isCaselessLetter(keyBuf, 'p') || telc.isCaselessLetter(keyBuf, 'k')) {
      this.togglePause()
    } else {
      super.keyPressed(keyBuf)
    }
  }

  seekAhead(seconds) {
    this.player.seekAhead(seconds)
  }

  seekBack(seconds) {
    this.player.seekBack(seconds)
  }

  togglePause() {
    this.player.togglePause()
  }

  async queueGrouplikeItem(item, play = true) {
    // TODO: Check if it's an item or a group

    const items = this.queueGrouplike.items

    // You can't put the same track in the queue twice - we automatically
    // remove the old entry. (You can't for a variety of technical reasons,
    // but basically you either have the display all bork'd, or new tracks
    // can't be added to the queue in the right order (because Object.assign
    // is needed to fix the display, but then you end up with a new object
    // that doesn't work with indexOf).)
    if (items.includes(item)) {
      items.splice(items.indexOf(item), 1)
    }

    items.push(item)
    this.queueListingElement.buildItems()

    if (play && !this.playingTrack) {
      this.playGrouplikeItem(item)
    }
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
    this.playingTrack = item
    try {
      await this.player.playFile(downloadFile)
    } finally {
      if (playingThisTrack || this.playingTrack !== item) {
        this.recordStore.getRecord(item).playing = false
      }
    }

    // playingThisTrack now means whether the track played through to the end
    // (true), or was stopped by a different track being started (false).

    if (playingThisTrack) {
      this.playingTrack = null
      this.playNextTrack(item)
    }
  }

  playNextTrack(track) {
    const queue = this.queueGrouplike
    let queueIndex = queue.items.indexOf(track)
    if (queueIndex === -1) {
      queueIndex = queue.items.length
    }
    queueIndex++

    if (queueIndex >= queue.items.length) {
      const parent = track[parentSymbol]
      if (!parent) {
        return
      }
      const index = parent.items.indexOf(track)
      const nextItem = parent.items[index + 1]
      if (!nextItem) {
        return
      }
      this.queueGrouplikeItem(nextItem, false)
      queueIndex = queue.items.length - 1
    }

    this.playGrouplikeItem(queue.items[queueIndex])
  }
}

class GrouplikeListingElement extends ListScrollForm {
  constructor(recordStore) {
    super('vertical')

    this.captureTab = false

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

    const wasSelected = (this.root.selected &&
      this.root.selected.directAncestors.includes(this))

    while (this.inputs.length) {
      this.removeInput(this.inputs[0])
    }

    for (const item of this.grouplike.items) {
      const itemElement = new GrouplikeItemElement(item, this.recordStore)
      itemElement.on('download', () => this.emit('download', item))
      itemElement.on('select', () => this.emit('select', item))
      this.addInput(itemElement)
    }

    if (wasSelected) {
      this.root.select(this)
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
      this.emit('select')
    }
  }
}

module.exports.AppElement = AppElement
