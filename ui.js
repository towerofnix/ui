const { getDownloaderFor } = require('./downloaders')
const { getPlayer } = require('./players')
const { parentSymbol, isGroup, isTrack, getItemPath } = require('./playlist-utils')
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
    this.queueGrouplike = {isTheQueue: true, items: []}


    this.form = new Form()
    this.addChild(this.form)

    this.paneLeft = new Pane()
    this.form.addChild(this.paneLeft)

    this.paneRight = new Pane()
    this.form.addChild(this.paneRight)

    this.grouplikeListingElement = new GrouplikeListingElement(this.recordStore)
    this.paneLeft.addChild(this.grouplikeListingElement)
    this.form.addInput(this.grouplikeListingElement, false)

    const handleSelectFromMain = item => {
      if (isGroup(item)) {
        this.grouplikeListingElement.loadGrouplike(item)
      } else {
        this.playGrouplikeItem(item)
      }
    }

    this.grouplikeListingElement.on('download', item => this.downloadGrouplikeItem(item))
    this.grouplikeListingElement.on('select (enter)', item => handleSelectFromMain(item))
    this.grouplikeListingElement.on('select (space)', item => this.handleSpacePressed(
      () => handleSelectFromMain(item)))
    this.grouplikeListingElement.on('queue', item => this.queueGrouplikeItem(item))

    const handleSelectFromPathElement = item => {
      this.form.curIndex = this.form.inputs.indexOf(this.grouplikeListingElement)
      this.root.select(this.grouplikeListingElement)
      if (isGroup(item)) {
        this.grouplikeListingElement.loadGrouplike(item)
      } else if (item[parentSymbol]) {
        this.grouplikeListingElement.loadGrouplike(item[parentSymbol])
        this.grouplikeListingElement.selectAndShow(item)
      }
    }

    this.paneLeft.addChild(this.grouplikeListingElement.pathElement)
    this.form.addInput(this.grouplikeListingElement.pathElement, false)
    this.grouplikeListingElement.pathElement.on('select', item => handleSelectFromPathElement(item))

    this.queueListingElement = new GrouplikeListingElement(this.recordStore)
    this.queueListingElement.loadGrouplike(this.queueGrouplike)
    this.paneRight.addChild(this.queueListingElement)
    this.form.addInput(this.queueListingElement, false)

    this.queueListingElement.on('select (enter)', item => this.playGrouplikeItem(item, false))
    this.queueListingElement.on('select (space)', item => this.handleSpacePressed(
      () => this.playGrouplikeItem(item, false)))

    this.paneRight.addChild(this.queueListingElement.pathElement)
    this.form.addInput(this.queueListingElement.pathElement, false)
    this.queueListingElement.pathElement.on('select', item => handleSelectFromPathElement(item))

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
    this.paneLeft.h = this.contentH - 5
    this.paneRight.x = this.paneLeft.right
    this.paneRight.w = this.contentW - this.paneLeft.right
    this.paneRight.h = this.paneLeft.h
    this.playbackPane.y = this.paneLeft.bottom
    this.playbackPane.w = this.contentW
    this.playbackPane.h = this.contentH - this.playbackPane.y

    const fixListingLayout = listing => {
      listing.fillParent()
      listing.h--
      listing.pathElement.y = listing.parent.contentH - 1
      listing.pathElement.w = listing.parent.contentW
    }

    fixListingLayout(this.grouplikeListingElement)
    fixListingLayout(this.queueListingElement)

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
    } else if (telc.isShiftUp(keyBuf)) {
      this.playPreviousTrack(this.playingTrack)
    } else if (telc.isShiftDown(keyBuf)) {
      this.playNextTrack(this.playingTrack)
    } else if (telc.isCharacter(keyBuf, '1') && this.grouplikeListingElement.selectable) {
      this.form.curIndex = this.form.inputs.indexOf(this.grouplikeListingElement)
      this.form.updateSelectedElement()
    } else if (telc.isCharacter(keyBuf, '2') && this.queueListingElement.selectable) {
      this.form.curIndex = this.form.inputs.indexOf(this.queueListingElement)
      this.form.updateSelectedElement()
    } else {
      super.keyPressed(keyBuf)
    }
  }

  handleSpacePressed(callback) {
    // Pauses/resumes if a track is currently playing; otherwise, calls the
    // callback function.

    if (this.playingTrack) {
      this.togglePause()
    } else {
      return callback()
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

  async queueGrouplikeItem(topItem, play = true, afterItem = null) {
    const newTrackIndex = this.queueGrouplike.items.length

    const recursivelyAddTracks = item => {
      // For groups, just queue all children.
      if (isGroup(item)) {
        for (const child of item.items) {
          recursivelyAddTracks(child)
        }

        return
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

      if (afterItem === 'FRONT') {
        items.unshift(item)
      } else if (afterItem && items.includes(afterItem)) {
        items.splice(items.indexOf(afterItem) + 1, 0, item)
      } else {
        items.push(item)
      }
    }

    recursivelyAddTracks(topItem)
    this.queueListingElement.buildItems()

    // This is the first new track, if a group was queued.
    const newTrack = this.queueGrouplike.items[newTrackIndex]
    if (play && !this.playingTrack && newTrack) {
      this.playGrouplikeItem(newTrack, false)
    }
  }

  async downloadGrouplikeItem(item) {
    if (isGroup(item)) {
      // TODO: Download all children (recursively), show a confirmation prompt
      // if there are a lot of items (remember to flatten).
      return
    }

    const arg = item.downloaderArg
    this.recordStore.getRecord(item).downloading = true
    try {
      return await getDownloaderFor(arg)(arg)
    } finally {
      this.recordStore.getRecord(item).downloading = false
    }
  }

  async playGrouplikeItem(item, shouldQueue = true) {
    if (this.player === null) {
      throw new Error('Attempted to play before a player was loaded')
    }

    let playingThisTrack = true
    this.emit('playing new track')
    this.once('playing new track', () => {
      playingThisTrack = false
    })

    if (shouldQueue) {
      this.queueGrouplikeItem(item, false, this.playingTrack)
    }

    // TODO: Check if it's an item or a group

    // If, by the time the track is downloaded, we're playing something
    // different from when the download started, assume that we just want to
    // keep listening to whatever new thing we started.

    const oldTrack = this.playingTrack

    const downloadFile = await this.downloadGrouplikeItem(item)

    if (this.playingTrack !== oldTrack) {
      return
    }

    await this.player.kill()
    this.recordStore.getRecord(item).playing = true
    this.playingTrack = item
    this.playbackInfoElement.updateTrack(item)
    if (!this.queueListingElement.isSelected) {
      this.queueListingElement.selectAndShow(item)
    }
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
    if (!track) {
      return
    }

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

    this.playGrouplikeItem(queue.items[queueIndex], false)
  }

  playPreviousTrack(track) {
    if (!track) {
      return
    }

    const queue = this.queueGrouplike
    let queueIndex = queue.items.indexOf(track)
    if (queueIndex === -1) {
      queueIndex = queue.items.length
    }
    queueIndex--

    if (queueIndex < 0) {
      const parent = track[parentSymbol]
      if (!parent) {
        return
      }
      const index = parent.items.indexOf(track)
      const previousItem = parent.items[index - 1]
      if (!previousItem) {
        return
      }
      this.queueGrouplikeItem(previousItem, false, 'FRONT')
      queueIndex = 0
    }

    this.playGrouplikeItem(queue.items[queueIndex], false)
  }
}

class GrouplikeListingElement extends ListScrollForm {
  constructor(recordStore) {
    super('vertical')

    this.captureTab = false

    this.grouplike = null
    this.recordStore = recordStore

    this.pathElement = new PathElement()
  }

  keyPressed(keyBuf) {
    if (telc.isBackspace(keyBuf)) {
      this.loadParentGrouplike()
    } else {
      return super.keyPressed(keyBuf)
    }
  }

  loadGrouplike(grouplike) {
    this.grouplike = grouplike
    this.buildItems(true)
  }

  buildItems(resetIndex = false) {
    if (!this.grouplike) {
      throw new Error('Attempted to call buildItems before a grouplike was loaded')
    }

    const wasSelected = this.isSelected

    while (this.inputs.length) {
      this.removeInput(this.inputs[0])
    }

    const parent = this.grouplike[parentSymbol]
    if (parent) {
      const upButton = new Button('Up (to ' + (parent.name || 'unnamed group') + ')')
      upButton.on('pressed', () => this.loadParentGrouplike())
      this.addInput(upButton)
    }

    if (this.grouplike.items.length) {
      for (const item of this.grouplike.items) {
        const itemElement = new GrouplikeItemElement(item, this.recordStore)
        itemElement.on('download', () => this.emit('download', item))
        itemElement.on('select (space)', () => this.emit('select (space)', item))
        itemElement.on('select (enter)', () => this.emit('select (enter)', item))
        itemElement.on('queue', () => this.emit('queue', item))
        this.addInput(itemElement)
      }
    } else if (!this.grouplike.isTheQueue) {
      this.addInput(new Button('(No items in this group)'))
    }

    if (wasSelected) {
      if (resetIndex) {
        this.curIndex = this.firstItemIndex
        this.scrollItems = 0
        this.updateSelectedElement()
      } else {
        this.root.select(this)
      }
    }

    this.fixLayout()
  }

  loadParentGrouplike() {
    if (!this.grouplike) {
      return
    }

    const parent = this.grouplike[parentSymbol]
    if (parent) {
      const oldGrouplike = this.grouplike
      this.loadGrouplike(parent)

      const index = this.inputs.findIndex(inp => inp.item === oldGrouplike)
      if (typeof index === 'number') {
        this.curIndex = index
      } else {
        this.curIndex = this.firstItemIndex
      }
      this.updateSelectedElement()
      this.scrollSelectedElementIntoView()
    }
  }

  selectAndShow(item) {
    const index = this.inputs.findIndex(inp => inp.item === item)
    if (index >= 0) {
      this.curIndex = index
      if (this.isSelected) {
        this.updateSelectedElement()
      }
      this.scrollSelectedElementIntoView()
    }
  }

  set curIndex(newIndex) {
    this._curIndex = newIndex

    if (this.pathElement && this.inputs[this.curIndex]) {
      this.pathElement.showItem(this.inputs[this.curIndex].item)
    }
  }

  get curIndex() {
    return this._curIndex
  }

  get firstItemIndex() {
    return Math.min(this.inputs.length, 1)
  }

  get isSelected() {
    return this.root.selected && this.root.selected.directAncestors.includes(this)
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

    if (isGroup(this.item)) {
      writable.write(ansi.setAttributes([ansi.C_BLUE, ansi.A_BRIGHT]))
    }

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
    if (isGroup(this.item)) {
      writable.write('G')
    } else if (record.downloading) {
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
    } else if (telc.isSpace(keyBuf)) {
      this.emit('select (space)')
    } else if (telc.isEnter(keyBuf)) {
      this.emit('select (enter)')
    }
  }
}

class PathElement extends ListScrollForm {
  constructor() {
    super('horizontal')
    this.captureTab = false
  }

  showItem(item) {
    while (this.inputs.length) {
      this.removeInput(this.inputs[0])
    }

    if (!isTrack(item) && !isGroup(item)) {
      return
    }

    const itemPath = getItemPath(item)

    for (const pathItem of itemPath) {
      const isLast = pathItem === itemPath[itemPath.length - 1]
      const element = new PathItemElement(pathItem, isLast)
      element.on('select', () => this.emit('select', pathItem))
      element.fixLayout()
      this.addInput(element)
    }

    this.curIndex = this.inputs.length - 1

    this.scrollToEnd()
    this.fixLayout()
  }
}

class PathItemElement extends FocusElement {
  constructor(item, isLast) {
    super()

    this.item = item
    this.isLast = isLast

    this.button = new Button(item.name || '(Unnamed)')
    this.addChild(this.button)

    this.button.on('pressed', () => {
      this.emit('select')
    })

    this.arrowLabel = new Label(isLast ? '' : ' > ')
    this.addChild(this.arrowLabel)
  }

  focused() {
    this.root.select(this.button)
  }

  fixLayout() {
    this.button.fixLayout()
    this.arrowLabel.fixLayout()
    this.w = this.button.w + this.arrowLabel.w
    this.arrowLabel.x = this.button.right
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

    this.downloadLabel = new Label('')
    this.addChild(this.downloadLabel)
  }

  fixLayout() {
    const centerX = el => el.x = Math.round((this.w - el.w) / 2)
    centerX(this.progressTextLabel)
    centerX(this.trackNameLabel)
    centerX(this.downloadLabel)

    this.trackNameLabel.y = 0
    this.progressBarLabel.y = 1
    this.progressTextLabel.y = this.progressBarLabel.y
    this.downloadLabel.y = 2
  }

  updateProgress({timeDone, timeLeft, duration, lenSecTotal, curSecTotal}) {
    this.progressBarLabel.text = '-'.repeat(Math.floor(this.w / lenSecTotal * curSecTotal))
    this.progressTextLabel.text = timeDone + ' / ' + duration
    this.fixLayout()
  }

  updateTrack(track) {
    this.trackNameLabel.text = track.name
    this.downloadLabel.text = `(From: ${track.downloaderArg})`
    this.fixLayout()
  }
}

module.exports.AppElement = AppElement
