'use strict'

const path = require('path')
const fs = require('fs')

const { promisify } = require('util')
const unlink = promisify(fs.unlink)

const parentSymbol = Symbol('Parent group')

function updatePlaylistFormat(playlist) {
  const defaultPlaylist = {
    options: [],
    items: []
  }

  let playlistObj = {}

  // Playlists can be in two formats...
  if (Array.isArray(playlist)) {
    // ..the first, a simple array of tracks and groups;

    playlistObj = {items: playlist}
  } else {
    // ..or an object including metadata and configuration as well as the
    // array described in the first.

    playlistObj = playlist

    // The 'tracks' property was used for a while, but it doesn't really make
    // sense, since we also store groups in the 'tracks' property. So it was
    // renamed to 'items'.
    if ('tracks' in playlistObj) {
      playlistObj.items = playlistObj.tracks
      delete playlistObj.tracks
    }
  }

  const fullPlaylistObj = Object.assign(defaultPlaylist, playlistObj)

  return updateGroupFormat(fullPlaylistObj)
}

function updateGroupFormat(group) {
  const defaultGroup = {
    name: '',
    items: []
  }

  let groupObj = {}

  if (Array.isArray(group[1])) {
    groupObj = {name: group[0], items: group[1]}
  } else {
    groupObj = group
  }

  groupObj = Object.assign(defaultGroup, groupObj)

  groupObj.items = groupObj.items.map(item => {
    // Check if it's a group; if not, it's probably a track.
    if (typeof item[1] === 'array' || item.items) {
      item = updateGroupFormat(item)
    } else {
      item = updateTrackFormat(item)

      // TODO: Should this also apply to groups? Is recursion good? Probably
      // not!
      //
      // TODO: How should saving/serializing handle this? For now it just saves
      // the result, after applying. (I.e., "apply": {"foo": "baz"} will save
      // child tracks with {"foo": "baz"}.)
      if (groupObj.apply) {
        Object.assign(item, groupObj.apply)
      }
    }

    item[parentSymbol] = groupObj

    return item
  })

  return groupObj
}

function updateTrackFormat(track) {
  const defaultTrack = {
    name: '',
    downloaderArg: ''
  }

  let trackObj = {}

  if (Array.isArray(track)) {
    if (track.length === 2) {
      trackObj = {name: track[0], downloaderArg: track[1]}
    } else {
      throw new Error("Unexpected non-length 2 array-format track")
    }
  } else {
    trackObj = track
  }

  return Object.assign(defaultTrack, trackObj)
}

function filterTracks(grouplike, handleTrack) {
  // Recursively filters every track in the passed grouplike. The track-handler
  // function passed should either return true (to keep a track) or false (to
  // remove the track). After tracks are filtered, groups which contain no
  // items are removed.

  if (typeof handleTrack !== 'function') {
    throw new Error("Missing track handler function")
  }

  return Object.assign({}, grouplike, {
    items: grouplike.items.filter(item => {
      if (isTrack(item)) {
        return handleTrack(item)
      } else {
        return true
      }
    }).map(item => {
      if (isGroup(item)) {
        return filterTracks(item, handleTrack)
      } else {
        return item
      }
    }).filter(item => {
      if (isGroup(item)) {
        return item.items.length > 0
      } else {
        return true
      }
    })
  })
}

function flattenGrouplike(grouplike) {
  // Flattens a group-like, taking all of the non-group items (tracks) at all
  // levels in the group tree and returns them as a new group containing those
  // tracks.

  return {
    items: grouplike.items.map(item => {
      if (isGroup(item)) {
        return flattenGrouplike(item).items
      } else {
        return [item]
      }
    }).reduce((a, b) => a.concat(b), [])
  }
}

function collectGrouplikeChildren(grouplike, filter = null) {
  // Collects all descendants of a grouplike into a single flat array.
  // Can be passed a filter function, which will decide whether or not to add
  // an item to the return array. However, note that all descendants will be
  // checked against this function; a group will be descended through even if
  // the filter function checks false against it.
  // Returns an array, not a grouplike.

  const items = []

  for (const item of grouplike.items) {
    if (filter === null || filter(item) === true) {
      items.push(item)
    }

    if (isGroup(item)) {
      items.push(...collectGrouplikeChildren(item, filter))
    }
  }

  return items
}

function partiallyFlattenGrouplike(grouplike, resultDepth) {
  // Flattens a grouplike so that it is never more than a given number of
  // groups deep, INCLUDING the "top" group -- e.g. a resultDepth of 2
  // means that there can be one level of groups remaining in the resulting
  // grouplike, plus the top group.

  if (resultDepth <= 1) {
    return flattenGrouplike(grouplike)
  }

  const items = grouplike.items.map(item => {
    if (isGroup(item)) {
      return {items: partiallyFlattenGrouplike(item, resultDepth - 1).items}
    } else {
      return item
    }
  })

  return {items}
}

function collapseGrouplike(grouplike) {
  // Similar to partiallyFlattenGrouplike, but doesn't discard the individual
  // ordering of tracks; rather, it just collapses them all to one level.

  // Gather the groups. The result is an array of groups.
  // Collapsing [Kar/Baz/Foo, Kar/Baz/Lar] results in [Foo, Lar].
  // Aha! Just collect the top levels.
  // Only trouble is what to do with groups that contain both groups and
  // tracks. Maybe give them their own separate group (e.g. Baz).

  const subgroups = grouplike.items.filter(x => isGroup(x))
  const nonGroups = grouplike.items.filter(x => !isGroup(x))

  // Get each group's own collapsed groups, and store them all in one big
  // array.
  const ret = subgroups.map(group => {
    return collapseGrouplike(group).items
  }).reduce((a, b) => a.concat(b), [])

  if (nonGroups.length) {
    ret.unshift({name: grouplike.name, items: nonGroups})
  }

  return {items: ret}
}

function filterGrouplikeByProperty(grouplike, property, value) {
  // Returns a copy of the original grouplike, only keeping tracks with the
  // given property-value pair. (If the track's value for the given property
  // is an array, this will check if that array includes the given value.)

  return Object.assign({}, grouplike, {
    items: grouplike.items.map(item => {
      if (isGroup(item)) {
        const newGroup = filterGrouplikeByProperty(item, property, value)
        if (newGroup.items.length) {
          return newGroup
        } else {
          return false
        }
      } else if (isTrack(item)) {
        const itemValue = item[property]
        if (Array.isArray(itemValue) && itemValue.includes(value)) {
          return item
        } else if (item[property] === value) {
          return item
        } else {
          return false
        }
      } else {
        return item
      }
    }).filter(item => item !== false)
  })
}

function filterPlaylistByPathString(playlist, pathString) {
  // Calls filterGroupContentsByPath, taking an unparsed path string.

  return filterGrouplikeByPath(playlist, parsePathString(pathString))
}

function filterGrouplikeByPath(grouplike, pathParts) {
  // Finds a group by following the given group path and returns it. If the
  // function encounters an item in the group path that is not found, it logs
  // a warning message and returns the group found up to that point. If the
  // pathParts array is empty, it returns the group given to the function.

  if (pathParts.length === 0) {
    return grouplike
  }

  let firstPart = pathParts[0]
  let possibleMatches

  if (firstPart.startsWith('?')) {
    possibleMatches = collectGrouplikeChildren(grouplike)
    firstPart = firstPart.slice(1)
  } else {
    possibleMatches = grouplike.items
  }

  const titleMatch = (group, caseInsensitive = false) => {
    let a = group.name
    let b = firstPart

    if (caseInsensitive) {
      a = a.toLowerCase()
      b = b.toLowerCase()
    }

    return a === b || a === b + '/'
  }

  let match = possibleMatches.find(g => titleMatch(g, false))

  if (!match) {
    match = possibleMatches.find(g => titleMatch(g, true))
  }

  if (match) {
    if (pathParts.length > 1) {
      const rest = pathParts.slice(1)
      return filterGrouplikeByPath(match, rest)
    } else {
      return match
    }
  } else {
    console.warn(`Not found: "${firstPart}"`)
    return null
  }
}

function removeGroupByPathString(playlist, pathString) {
  // Calls removeGroupByPath, taking a path string, rather than a parsed path.

  return removeGroupByPath(playlist, parsePathString(pathString))
}

function removeGroupByPath(playlist, pathParts) {
  // Removes the group at the given path from the given playlist.

  const groupToRemove = filterGrouplikeByPath(playlist, pathParts)

  if (groupToRemove === null) {
    return
  }

  if (playlist === groupToRemove) {
    console.error(
      'You can\'t remove the playlist from itself! Instead, try --clear' +
      ' (shorthand -c).'
    )

    return
  }

  if (!(parentSymbol in groupToRemove)) {
    console.error(
      `Group ${pathParts.join('/')} doesn't have a parent, so we can't` +
      ' remove it from the playlist.'
    )

    return
  }

  const parent = groupToRemove[parentSymbol]

  const index = parent.items.indexOf(groupToRemove)

  if (index >= 0) {
    parent.items.splice(index, 1)
  } else {
    console.error(
      `Group ${pathParts.join('/')} doesn't exist, so we can't explicitly ` +
      'ignore it.'
    )
  }
}

function getPlaylistTreeString(playlist, showTracks = false) {
  function recursive(group) {
    const groups = group.items.filter(x => isGroup(x))
    const nonGroups = group.items.filter(x => !isGroup(x))

    const childrenString = groups.map(group => {
      const name = group.name
      const groupString = recursive(group)

      if (groupString) {
        const indented = groupString.split('\n').map(l => '| ' + l).join('\n')
        return '\n' + name + '\n' + indented
      } else {
        return name
      }
    }).join('\n')

    let tracksString = ''
    if (showTracks) {
      tracksString = nonGroups.map(g => g.name).join('\n')
    }

    if (tracksString && childrenString) {
      return tracksString + '\n' + childrenString
    } else if (childrenString) {
      return childrenString
    } else if (tracksString) {
      return tracksString
    } else {
      return ''
    }
  }

  return recursive(playlist)
}

function getItemPath(item) {
  if (item[parentSymbol]) {
    return [...getItemPath(item[parentSymbol]), item]
  } else {
    return [item]
  }
}

function getItemPathString(item) {
  // Gets the playlist path of an item by following its parent chain.
  //
  // Returns a string in format Foo/Bar/Baz, where Foo and Bar are group
  // names, and Baz is the name of the item.
  //
  // Unnamed parents are given the name '(Unnamed)'.
  // Always ignores the root (top) group.
  //
  // Requires that the given item be from a playlist processed by
  // updateGroupFormat.

  // Check if the parent is not the top level group.
  // The top-level group is included in the return path as '/'.
  if (item[parentSymbol]) {
    const displayName = item.name || '(Unnamed)'

    if (item[parentSymbol][parentSymbol]) {
      return getItemPathString(item[parentSymbol]) + '/' + displayName
    } else {
      return '/' + displayName
    }
  } else {
    return '/'
  }
}

function parsePathString(pathString) {
  const pathParts = pathString.split('/').filter(item => item.length)
  return pathParts
}

function getTrackIndexInParent(track) {
  if (parentSymbol in track === false) {
    throw new Error(
      'getTrackIndexInParent called with a track that has no parent!'
    )
  }

  const parent = track[parentSymbol]

  let i = 0, foundTrack = false;
  for (; i < parent.items.length; i++) {
    if (isSameTrack(track, parent.items[i])) {
      foundTrack = true
      break
    }
  }

  if (foundTrack === false) {
    return [-1, parent.items.length]
  } else {
    return [i, parent.items.length]
  }
}

function isGroup(obj) {
  return !!(obj && obj.items)
}

function isTrack(obj) {
  return !!(obj && obj.downloaderArg)
}

module.exports = {
  parentSymbol,
  updatePlaylistFormat, updateTrackFormat,
  filterTracks,
  flattenGrouplike,
  partiallyFlattenGrouplike, collapseGrouplike,
  filterGrouplikeByProperty,
  filterPlaylistByPathString, filterGrouplikeByPath,
  removeGroupByPathString, removeGroupByPath,
  getPlaylistTreeString,
  getItemPath, getItemPathString,
  parsePathString,
  getTrackIndexInParent,
  isGroup, isTrack
}
