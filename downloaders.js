const { promisifyProcess } = require('./general-util')
const { promisify } = require('util')
const { spawn } = require('child_process')
const { Base64 } = require('js-base64')
const mkdirp = promisify(require('mkdirp'))
const fs = require('fs')
const fse = require('fs-extra')
const fetch = require('node-fetch')
const tempy = require('tempy')
const path = require('path')
const sanitize = require('sanitize-filename')

const writeFile = promisify(fs.writeFile)
const rename = promisify(fs.rename)
const stat = promisify(fs.stat)
const readdir = promisify(fs.readdir)
const symlink = promisify(fs.symlink)
const copyFile = fse.copy

const cachify = (identifier, baseFunction) => {
  return async arg => {
    // Determine where the final file will end up. This is just a directory -
    // the file's own name is determined by the downloader.
    const cacheDir = downloaders.rootCacheDir + '/' + identifier
    const finalDirectory = cacheDir + '/' + Base64.encode(arg)

    // Check if that directory only exists. If it does, return the file in it,
    // because it being there means we've already downloaded it at some point
    // in the past.
    let exists
    try {
      await stat(finalDirectory)
      exists = true
    } catch (error) {
      // ENOENT means the folder doesn't exist, which is one of the potential
      // expected outputs, so do nothing and let the download continue.
      if (error.code === 'ENOENT') {
        exists = false
      }
      // Otherwise, there was some unexpected error, so throw it:
      else {
        throw error
      }
    }

    // If the directory exists, return the file in it. Downloaders always
    // return only one file, so it's expected that the directory will only
    // contain a single file. We ignore any other files. Note we also allow
    // the download to continue if there aren't any files in the directory -
    // that would mean that the file (but not the directory) was unexpectedly
    // deleted.
    if (exists) {
      const files = await readdir(finalDirectory)
      if (files.length >= 1) {
        return finalDirectory + '/' + files[0]
      }
    }

    // The "temporary" output, aka the download location. Generally in a
    // temporary location as returned by tempy.
    const tempFile = await baseFunction(arg)

    // Then move the download to the final location. First we need to make the
    // folder exist, then we move the file.
    const finalFile = finalDirectory + '/' + path.basename(tempFile)
    await mkdirp(finalDirectory)
    await rename(tempFile, finalFile)

    // And return.
    return finalFile
  }
}

const removeFileProtocol = arg => {
  const fileProto = 'file://'
  if (arg.startsWith(fileProto)) {
    return decodeURIComponent(arg.slice(fileProto.length))
  } else {
    return arg
  }
}

const downloaders = {
  extension: 'mp3', // Generally target file extension, used by youtube-dl

  // TODO: Cross-platform stuff
  rootCacheDir: process.env.HOME + '/.http-music/downloads',

  http: cachify('http', arg => {
    const out = (
      tempy.directory() + '/' +
      sanitize(decodeURIComponent(path.basename(arg))))

    return fetch(arg)
      .then(response => response.buffer())
      .then(buffer => writeFile(out, buffer))
      .then(() => out)
  }),

  youtubedl: cachify('youtubedl', arg => {
    const out = (
      tempy.directory() + '/download.' + downloaders.extension)

    const opts = [
      '--quiet',
      '--extract-audio',
      '--audio-format', downloaders.extension,
      '--output', out,
      arg
    ]

    return promisifyProcess(spawn('youtube-dl', opts))
      .then(() => out)
  }),

  local: cachify('local', arg => {
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
    arg = removeFileProtocol(arg)

    // TODO: Is it necessary to sanitize here?
    // Haha, the answer to "should I sanitize" is probably always YES..
    const base = path.basename(arg, path.extname(arg))
    const out = tempy.directory() + '/' + sanitize(base) + path.extname(arg)

    return copyFile(arg, out)
      .then(() => out)
  }),

  locallink: cachify('locallink', arg => {
    // Like the local downloader, but creates a symbolic link to the argument.

    arg = removeFileProtocol(arg)
    const base = path.basename(arg, path.extname(arg))
    const out = tempy.directory() + '/' + sanitize(base) + path.extname(arg)

    return symlink(path.resolve(arg), out)
      .then(() => out)
  }),

  echo: arg => arg,

  getDownloaderFor: arg => {
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      if (arg.includes('youtube.com')) {
        return downloaders.youtubedl
      } else {
        return downloaders.http
      }
    } else {
      // return downloaders.local
      return downloaders.locallink
    }
  }
}

module.exports = downloaders
