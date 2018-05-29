const { promisifyProcess } = require('./general-util')
const { spawn } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const fse = require('fs-extra')
const fetch = require('node-fetch')
const tempy = require('tempy')
const path = require('path')
const sanitize = require('sanitize-filename')

const writeFile = promisify(fs.writeFile)
const copyFile = fse.copy

// Pseudo-tempy!!
/*
const tempy = {
  directory: () => './tempy-fake'
}
*/

class Downloader {
  download(arg) {}
}

// oh who cares about classes or functions or kool things

const downloaders = {
  extension: 'mp3', // Generally target file extension

  cache: {
    http: {},
    youtubedl: {},
    local: {}
  },

  http: arg => {
    const cached = downloaders.cache.http[arg]
    if (cached) return cached

    const out = (
      tempy.directory() + '/' +
      sanitize(decodeURIComponent(path.basename(arg))))

    return fetch(arg)
      .then(response => response.buffer())
      .then(buffer => writeFile(out, buffer))
      .then(() => downloaders.cache.http[arg] = out)
  },

  youtubedl: arg => {
    const cached = downloaders.cache.youtubedl[arg]
    if (cached) return cached

    const out = (
      tempy.directory() + '/' + sanitize(arg) +
      '.' + downloaders.extname)

    const opts = [
      '--quiet',
      '--extract-audio',
      '--audio-format', downloaders.extension,
      '--output', out,
      arg
    ]

    return promisifyProcess(spawn('youtube-dl', opts))
      .then(() => downloaders.cache.youtubedl[arg] = out)
      .catch(err => false)
  },

  local: arg => {
    // Usually we'd just return the given argument in a local
    // downloader, which is efficient, since there's no need to
    // copy a file from one place on the hard drive to another.
    // But reading from a separate drive (e.g. a USB stick or a
    // CD) can take a lot longer than reading directly from the
    // computer's own drive, so this downloader copies the file
    // to a temporary file on the computer's drive.
    // Ideally, we'd be able to check whether a file is on the
    // computer's main drive mount or not before going through
    // the steps to copy, but I'm not sure if there's a way to
    // do that (and it's even less likely there'd be a cross-
    // platform way).

    // It's possible the downloader argument starts with the "file://"
    // protocol string; in that case we'll want to snip it off and URL-
    // decode the string.
    const fileProto = 'file://'
    if (arg.startsWith(fileProto)) {
      arg = decodeURIComponent(arg.slice(fileProto.length))
    }

    // TODO: Is it necessary to sanitize here?
    // Haha, the answer to "should I sanitize" is probably always YES..
    const base = path.basename(arg, path.extname(arg))
    const out = (
      tempy.directory() + '/' + sanitize(base) + path.extname(arg))

    return copyFile(arg, out)
      .then(() => downloaders.cache.local[arg] = out)
  },

  echo: arg => arg,

  getDownloaderFor: arg => {
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      if (arg.includes('youtube.com')) {
        return downloaders.youtubedl
      } else {
        return downloaders.http
      }
    } else {
      return downloaders.local
    }
  }
}

module.exports = downloaders
