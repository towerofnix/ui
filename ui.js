const { getDownloaderFor } = require('./downloaders')
const { getPlayer } = require('./players')
const { parentSymbol, isGroup } = require('./playlist-utils')
const ansi = require('./tui-lib/util/ansi')
const Button = require('./tui-lib/ui/form/Button')
const DisplayElement = require('./tui-lib/ui/DisplayElement')
const FocusElement = require('./tui-lib/ui/form/FocusElement')
const Form = require('./tui-lib/ui/form/Form')
const Label = require('./tui-lib/ui/Label')
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
    this.grouplikeListingElement.on('select', item => {
      if (isGroup(item)) {
        this.grouplikeListingElement.loadGrouplike(item)
      } else {
        this.queueGrouplikeItem(item)
      }
    })
    this.grouplikeListingElement.on('queue', item => this.queueGrouplikeItem(item))

    this.queueGrouplike = {isTheQueue: true, items: []}

    this.queueListingElement = new GrouplikeListingElement(this.recordStore)
    this.queueListingElement.loadGrouplike(this.queueGrouplike)
    this.paneRight.addChild(this.queueListingElement)
    this.form.addInput(this.queueListingElement, false)

    this.queueListingElement.on('select', item => this.playGrouplikeItem(item))

    this.playbackPane = new Pane()
    this.addChild(this.playbackPane)

    this.playbackInfoElement = new PlaybackInfoElement()
    this.playbackPane.addChild(this.playbackInfoElement)
  }

  async setup() {
    this.player = await getPlayer()
    this.player.on('printStatusLine', data => {
      this.playbackInfoElement.updateProgress(data)
    })
  }

  async shutdown() {
    await this.player.kill()
    this.emit('quitRequested')
  }

  fixLayout() {
    this.w = this.parent.contentW
    this.h = this.parent.contentH

    this.paneLeft.w = Math.max(Math.floor(0.8 * this.contentW), this.contentW - 80)
    this.paneLeft.h = this.contentH - 4
    this.paneRight.x = this.paneLeft.right
    this.paneRight.w = this.contentW - this.paneLeft.right
    this.paneRight.h = this.paneLeft.h
    this.playbackPane.y = this.paneLeft.bottom
    this.playbackPane.w = this.contentW
    this.playbackPane.h = this.contentH - this.playbackPane.y

    this.grouplikeListingElement.fillParent()
    this.queueListingElement.fillParent()
    this.playbackInfoElement.fillParent()
  }

  keyPressed(keyBuf) {
    if (keyBuf[0] === 0x03) {
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
    const newTrackIndex = this.queueGrouplike.items.length

    handleTrack: {
      // For groups, just queue all children.
      if (isGroup(item)) {
        for (const child of item.items) {
          await this.queueGrouplikeItem(child, false)
        }

        break handleTrack
      }

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
    }

    // This is the first new track, if a group was queued.
    const newTrack = this.queueGrouplike.items[newTrackIndex]
    if (play && !this.playingTrack && newTrack) {
      this.playGrouplikeItem(newTrack)
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
    this.playbackInfoElement.updateTrack(item)
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
    this.buildItems(true)
  }

  buildItems(resetIndex = false) {
    if (!this.grouplike) {
      throw new Error('Attempted to call buildItems before a grouplike was loaded')
    }

    const wasSelected = (this.root.selected &&
      this.root.selected.directAncestors.includes(this))

    while (this.inputs.length) {
      this.removeInput(this.inputs[0])
    }

    const parent = this.grouplike[parentSymbol]
    if (parent) {
      const upButton = new Button('Up (to ' + (parent.name || 'unnamed group') + ')')
      upButton.on('pressed', () => {
        this.loadGrouplike(parent)
      })
      this.addInput(upButton)
    }

    if (this.grouplike.items.length) {
      for (const item of this.grouplike.items) {
        const itemElement = new GrouplikeItemElement(item, this.recordStore)
        itemElement.on('download', () => this.emit('download', item))
        itemElement.on('select', () => this.emit('select', item))
        itemElement.on('queue', () => this.emit('queue', item))
        this.addInput(itemElement)
      }
    } else if (!this.grouplike.isTheQueue) {
      this.addInput(new Button('(No items in this group)'))
    }

    if (wasSelected) {
      if (resetIndex) {
        this.curIndex = Math.min(this.inputs.length, 1)
        this.scrollItems = 0
        this.updateSelectedElement()
      } else {
        this.root.select(this)
      }
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
    writable.write(this.item.name.slice(0, this.w - this.drawX))
    this.drawX += this.item.name.length
    writable.write(' '.repeat(Math.max(0, this.w - this.drawX)))

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
    if (telc.isCaselessLetter(keyBuf, 'd')) {
      this.emit('download')
    } else if (telc.isCaselessLetter(keyBuf, 'q')) {
      this.emit('queue')
    } else if (telc.isSelect(keyBuf)) {
      this.emit('select')
    }
  }
}

class PlaybackInfoElement extends DisplayElement {
  constructor() {
    super()

    this.progressBarLabel = new Label('')
    this.addChild(this.progressBarLabel)

    this.progressTextLabel = new Label('')
    this.addChild(this.progressTextLabel)

    this.trackNameLabel = new Label('')
    this.addChild(this.trackNameLabel)
  }

  fixLayout() {
    const centerX = el => el.x = Math.round((this.w - el.w) / 2)
    centerX(this.progressTextLabel)
    centerX(this.trackNameLabel)

    this.trackNameLabel.y = 0
    this.progressBarLabel.y = 1
    this.progressTextLabel.y = this.progressBarLabel.y
  }

  updateProgress({timeDone, timeLeft, duration, lenSecTotal, curSecTotal}) {
    this.progressBarLabel.text = '-'.repeat(Math.floor(this.w / lenSecTotal * curSecTotal))
    this.progressTextLabel.text = timeDone + ' / ' + duration
    this.fixLayout()
  }

  updateTrack(track) {
    this.trackNameLabel.text = track.name
    this.fixLayout()
  }
}

module.exports.AppElement = AppElement
