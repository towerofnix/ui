const recordSymbolKey = Symbol()

module.exports = class RecordStore {
  constructor() {
    // Each track (or whatever) gets a symbol which is used as a key here to
    // store more information.
    this.data = {}
  }

  getRecord(obj) {
    if (typeof obj !== 'object') {
      throw new TypeError('Cannot get the record of a non-object')
    }

    if (!obj[recordSymbolKey]) {
      obj[recordSymbolKey] = Symbol()
    }

    if (!this.data[obj[recordSymbolKey]]) {
      this.data[obj[recordSymbolKey]] = {}
    }

    return this.data[obj[recordSymbolKey]]
  }

  deleteRecord(obj) {
    if (typeof obj !== 'object') {
      throw new TypeError('Non-objects cannot have a record in the first place')
    }

    if (obj[recordSymbolKey]) {
      delete this.data[obj[recordSymbolKey]]
    }
  }
}
