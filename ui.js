const ansi = require('./tui-lib/util/ansi')
const Button = require('./tui-lib/ui/form/Button')
const FocusElement = require('./tui-lib/ui/form/FocusElement')
const ListScrollForm = require('./tui-lib/ui/form/ListScrollForm')
const Pane = require('./tui-lib/ui/Pane')
const RecordStore = require('./record-store')

class AppElement extends FocusElement {
  constructor(internalApp) {
    super()

    this.internalApp = internalApp
    this.recordStore = new RecordStore()

    this.pane = new Pane()
    this.addChild(this.pane)

    this.grouplikeListingElement = new GrouplikeListingElement(this.recordStore)
    this.pane.addChild(this.grouplikeListingElement)
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
    if (keyBuf[0] === 0x03) { // ^C
      this.emit('quitRequested')
      return
    }

    super.keyPressed(keyBuf)
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
      this.addInput(new GrouplikeItemElement(item, this.recordStore))
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

    writable.write(' ')
    if (this.recordStore.getRecord(this.item).downloading) {
      writable.write(braille[Math.floor(Date.now() / 250) % 6])
    } else {
      writable.write(' ')
    }
    writable.write(' ')
  }
}

module.exports.AppElement = AppElement
