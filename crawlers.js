const fs = require('fs')
const path = require('path')
const naturalSort = require('node-natural-sort')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const url = require('url')
const { downloadPlaylistFromOptionValue, promisifyProcess } = require('./general-util')
const { spawn } = require('child_process')

const { promisify } = require('util')
const readDir = promisify(fs.readdir)
const stat = promisify(fs.stat)

function sortIgnoreCase(sortFunction) {
  return function(a, b) {
    return sortFunction(a.toLowerCase(), b.toLowerCase())
  }
}

function crawlHTTP(absURL, opts = {}, internals = {}) {
  // Recursively crawls a given URL, following every link to a deeper path and
  // recording all links in a tree (in the same format playlists use). Makes
  // multiple attempts to download failed paths.

  const {
    verbose = false,

    maxAttempts = 5,

    keepSeparateHosts = false,
    stayInSameDirectory = true,

    keepAnyFileType = false,
    fileTypes = ['wav', 'ogg', 'oga', 'mp3', 'mp4', 'm4a', 'mov', 'mpga', 'mod'],

    filterRegex = null
  } = opts

  if (!internals.attempts) internals.attempts = 0

  // TODO: Should absURL initially be added into this array? I'd like to
  // re-program this entire crawl function to make more sense - "internal"
  // dictionaries aren't quite easy to reason about!
  if (!internals.allURLs) internals.allURLs = []

  const verboseLog = text => {
    if (verbose) {
      console.error(text)
    }
  }

  const absURLObj = new url.URL(absURL)

  return fetch(absURL)
    .then(
      res => res.text().then(async text => {
        const links = getHTMLLinks(text)

        const items = []

        for (const link of links) {
          let [ name, href ] = link

          // If the name (that's the content inside of <a>..</a>) ends with a
          // slash, that's probably just an artifact of a directory lister;
          // not actually part of the intended content. So we remove it!
          if (name.endsWith('/')) {
            name = name.slice(0, -1)
          }

          name = name.trim()

          const urlObj = new url.URL(href, absURL + '/')
          const linkURL = url.format(urlObj)

          if (internals.allURLs.includes(linkURL)) {
            verboseLog("[Ignored] Already done this URL: " + linkURL)
            continue
          }

          internals.allURLs.push(linkURL)

          if (filterRegex && !(filterRegex.test(linkURL))) {
            verboseLog("[Ignored] Failed regex: " + linkURL)
            continue
          }

          if (!keepSeparateHosts && urlObj.host !== absURLObj.host) {
            verboseLog("[Ignored] Inconsistent host: " + linkURL)
            continue
          }

          if (stayInSameDirectory) {
            const relative = path.relative(absURLObj.pathname, urlObj.pathname)
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
              verboseLog("[Ignored] Outside of parent directory: " + linkURL)
              continue
            }
          }

          if (href.endsWith('/')) {
            // It's a directory!

            verboseLog("[Dir] " + linkURL)

            items.push(await (
              crawlHTTP(linkURL, opts, Object.assign({}, internals))
                .then(({ items }) => ({name, items}))
            ))
          } else {
            // It's a file!

            const extensions = fileTypes.map(t => '.' + t)

            if (
              !keepAnyFileType &&
              !(extensions.includes(path.extname(href)))
            ) {
              verboseLog("[Ignored] Bad extension: " + linkURL)
              continue
            }

            verboseLog("[File] " + linkURL)
            items.push({name, downloaderArg: linkURL})
          }
        }

        return {items}
      }),

      err => {
        console.warn("Failed to download: " + absURL)

        if (internals.attempts < maxAttempts) {
          console.warn(
            `Trying again. Attempt ${internals.attempts + 1}/${maxAttempts}...`
          )

          return crawlHTTP(absURL, opts, Object.assign({}, internals, {
            attempts: internals.attempts + 1
          }))
        } else {
          console.error(
            "We've hit the download attempt limit (" + maxAttempts + "). " +
            "Giving up on this path."
          )

          throw 'FAILED_DOWNLOAD'
        }
      }
    )
    .catch(error => {
      if (error === 'FAILED_DOWNLOAD') {
        // Debug logging for this is already handled above.
        return []
      } else {
        throw error
      }
    })
}

function getHTMLLinks(text) {
  // Never parse HTML with a regex!
  const $ = cheerio.load(text)

  return $('a').get().map(el => {
    const $el = $(el)
    return [$el.text(), $el.attr('href')]
  })
}



function crawlLocal(dirPath, extensions = [
  'ogg', 'oga',
  'wav', 'mp3', 'mp4', 'm4a', 'aac',
  'mod'
]) {
  return readDir(dirPath).then(items => {
    items.sort(sortIgnoreCase(naturalSort()))

    return Promise.all(items.map(item => {
      const itemPath = path.join(dirPath, item)

      return stat(itemPath).then(stats => {
        if (stats.isDirectory()) {
          return crawlLocal(itemPath, extensions)
            .then(group => Object.assign({name: item}, group))
        } else if (stats.isFile()) {
          // Extname returns a string starting with a dot; we don't want the
          // dot, so we slice it off of the front.
          const ext = path.extname(item).slice(1)

          if (extensions.includes(ext)) {
            // The name of the track doesn't include the file extension; a user
            // probably wouldn't add the file extensions to a hand-written
            // playlist, or want them in an auto-generated one.
            const basename = path.basename(item, path.extname(item))

            const track = {name: basename, downloaderArg: itemPath}
            return track
          } else {
            return null
          }
        }
      })
    }))
  }).then(items => items.filter(Boolean))
    .then(filteredItems => ({items: filteredItems}))
}

async function crawlYouTube(url) {
  const ytdl = spawn('youtube-dl', [
    '-j', // Output as JSON
    '--flat-playlist',
    url
  ])

  const items = []

  ytdl.stdout.on('data', data => {
    const lines = data.toString().trim().split('\n')

    items.push(...lines.map(JSON.parse))
  })

  // Pass false so it doesn't show logging.
  await promisifyProcess(ytdl, false)

  return {
    items: items.map(item => {
      return {
        name: item.title,
        downloaderArg: 'https://youtube.com/watch?v=' + item.id
      }
    })
  }
}

async function openFile(input) {
  return JSON.parse(await downloadPlaylistFromOptionValue(input))
}

module.exports = {
  crawlHTTP,
  crawlLocal,
  crawlYouTube,
  openFile,

  getCrawlerByName: function(name) {
    switch (name) {
      case 'crawl-http': return crawlHTTP
      case 'crawl-local': return crawlLocal
      case 'crawl-youtube': return crawlYouTube
      case 'open-file': return openFile
      default: return null
    }
  }
}
