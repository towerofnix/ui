// stolen from http-music

const { spawn } = require('child_process')
const FIFO = require('fifo-js')
const EventEmitter = require('events')
const { commandExists, killProcess } = require('./general-util')

function getTimeStrings({curHour, curMin, curSec, lenHour, lenMin, lenSec}) {
  // Multiplication casts to numbers; addition prioritizes strings.
  // Thanks, JavaScript!
  const curSecTotal = (3600 * curHour) + (60 * curMin) + (1 * curSec)
  const lenSecTotal = (3600 * lenHour) + (60 * lenMin) + (1 * lenSec)
  const percentVal = (100 / lenSecTotal) * curSecTotal
  const percentDone = (
    (Math.trunc(percentVal * 100) / 100).toFixed(2) + '%'
  )

  const leftSecTotal = lenSecTotal - curSecTotal
  let leftHour = Math.floor(leftSecTotal / 3600)
  let leftMin = Math.floor((leftSecTotal - leftHour * 3600) / 60)
  let leftSec = Math.floor(leftSecTotal - leftHour * 3600 - leftMin * 60)

  const pad = val => val.toString().padStart(2, '0')
  curMin = pad(curMin)
  curSec = pad(curSec)
  lenMin = pad(lenMin)
  lenSec = pad(lenSec)
  leftMin = pad(leftMin)
  leftSec = pad(leftSec)

  // We don't want to display hour counters if the total length is less
  // than an hour.
  let timeDone, timeLeft, duration
  if (parseInt(lenHour) > 0) {
    timeDone = `${curHour}:${curMin}:${curSec}`
    timeLeft = `${leftHour}:${leftMin}:${leftSec}`
    duration = `${lenHour}:${lenMin}:${lenSec}`
  } else {
    timeDone = `${curMin}:${curSec}`
    timeLeft = `${leftMin}:${leftSec}`
    duration = `${lenMin}:${lenSec}`
  }

  return {percentDone, timeDone, timeLeft, duration}
}

class Player extends EventEmitter {
  constructor() {
    super()

    this.disablePlaybackStatus = false
  }

  set process(newProcess) {
    this._process = newProcess
    this._process.on('exit', code => {
      if (code !== 0 && !this._killed) {
        this.emit('crashed', code)
      }

      this._killed = false
    })
  }

  get process() {
    return this._process
  }

  playFile(file) {}
  seekAhead(secs) {}
  seekBack(secs) {}
  volUp(amount) {}
  volDown(amount) {}
  togglePause() {}

  async kill() {
    if (this.process) {
      this._killed = true
      await killProcess(this.process)
    }
  }

  printStatusLine(data) {
    // Quick sanity check - we don't want to print the status line if it's
    // disabled! Hopefully printStatusLine won't be called in that case, but
    // if it is, we should be careful.
    if (!this.disablePlaybackStatus) {
      this.emit('printStatusLine', data)
    }
  }
}

module.exports.MPVPlayer = class extends Player {
  getMPVOptions(file) {
    return ['--no-audio-display', file]
  }

  playFile(file) {
    // The more powerful MPV player. MPV is virtually impossible for a human
    // being to install; if you're having trouble with it, try the SoX player.

    this.process = spawn('mpv', this.getMPVOptions(file))

    this.process.stderr.on('data', data => {
      if (this.disablePlaybackStatus) {
        return
      }

      const match = data.toString().match(
        /(..):(..):(..) \/ (..):(..):(..) \(([0-9]+)%\)/
      )

      if (match) {
        const [
          curHour, curMin, curSec, // ##:##:##
          lenHour, lenMin, lenSec, // ##:##:##
          percent // ###%
        ] = match.slice(1)

        this.printStatusLine(getTimeStrings({curHour, curMin, curSec, lenHour, lenMin, lenSec}))
      }
    })

    return new Promise(resolve => {
      this.process.once('close', resolve)
    })
  }
}

module.exports.ControllableMPVPlayer = class extends module.exports.MPVPlayer {
  getMPVOptions(file) {
    return ['--input-file=' + this.fifo.path, ...super.getMPVOptions(file)]
  }

  playFile(file) {
    this.fifo = new FIFO()

    return super.playFile(file)
  }

  sendCommand(command) {
    if (this.fifo) {
      this.fifo.write(command)
    }
  }

  seekAhead(secs) {
    this.sendCommand(`seek +${parseFloat(secs)}`)
  }

  seekBack(secs) {
    this.sendCommand(`seek -${parseFloat(secs)}`)
  }

  volUp(amount) {
    this.sendCommand(`add volume +${parseFloat(amount)}`)
  }

  volDown(amount) {
    this.sendCommand(`add volume -${parseFloat(amount)}`)
  }

  togglePause() {
    this.sendCommand('cycle pause')
  }

  kill() {
    if (this.fifo) {
      this.fifo.close()
      delete this.fifo
    }

    return super.kill()
  }
}

module.exports.SoXPlayer = class extends Player {
  playFile(file) {
    // SoX's play command is useful for systems that don't have MPV. SoX is
    // much easier to install (and probably more commonly installed, as well).
    // You don't get keyboard controls such as seeking or volume adjusting
    // with SoX, though.

    this.process = spawn('play', [file])

    this.process.stdout.on('data', data => {
      process.stdout.write(data.toString())
    })

    // Most output from SoX is given to stderr, for some reason!
    this.process.stderr.on('data', data => {
      // The status line starts with "In:".
      if (data.toString().trim().startsWith('In:')) {
        if (this.disablePlaybackStatus) {
          return
        }

        const timeRegex = '([0-9]*):([0-9]*):([0-9]*)\.([0-9]*)'
        const match = data.toString().trim().match(new RegExp(
          `^In:([0-9.]+%)\\s*${timeRegex}\\s*\\[${timeRegex}\\]`
        ))

        if (match) {
          const percentStr = match[1]

          // SoX takes a loooooot of math in order to actually figure out the
          // duration, since it outputs the current time and the remaining time
          // (but not the duration).

          const [
            curHour, curMin, curSec, curSecFrac, // ##:##:##.##
            remHour, remMin, remSec, remSecFrac // ##:##:##.##
          ] = match.slice(2).map(n => parseInt(n))

          const duration = Math.round(
            (curHour + remHour) * 3600 +
            (curMin + remMin) * 60 +
            (curSec + remSec) * 1 +
            (curSecFrac + remSecFrac) / 100
          )

          const lenHour = Math.floor(duration / 3600)
          const lenMin = Math.floor((duration - lenHour * 3600) / 60)
          const lenSec = Math.floor(duration - lenHour * 3600 - lenMin * 60)

          this.printStatusLine(getTimeStrings({curHour, curMin, curSec, lenHour, lenMin, lenSec}))
        }
      }
    })

    return new Promise(resolve => {
      this.process.on('close', () => resolve())
    })
  }
}

module.exports.getPlayer = async function() {
  if (await commandExists('mpv')) {
    if (await commandExists('mkfifo')) {
      return new module.exports.ControllableMPVPlayer()
    } else {
      return new module.exports.MPVPlayer()
    }
  } else if (await commandExists('play')) {
    return new module.exports.SoXPlayer()
  } else {
    return null
  }
}
