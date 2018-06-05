const { spawn } = require('child_process')
const npmCommandExists = require('command-exists')

module.exports.promisifyProcess = function(proc, showLogging = true) {
  // Takes a process (from the child_process module) and returns a promise
  // that resolves when the process exits (or rejects, if the exit code is
  // non-zero).

  return new Promise((resolve, reject) => {
    if (showLogging) {
      proc.stdout.pipe(process.stdout)
      proc.stderr.pipe(process.stderr)
    }

    proc.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(code)
      }
    })
  })
}

module.exports.commandExists = async function(command) {
  // When the command-exists module sees that a given command doesn't exist, it
  // throws an error instead of returning false, which is not what we want.

  try {
    return await npmCommandExists(command)
  } catch(err) {
    return false
  }
}

module.exports.killProcess = async function(proc) {
  // Windows is stupid and doesn't like it when we try to kill processes.
  // So instead we use taskkill! https://stackoverflow.com/a/28163919/4633828

  if (await module.exports.commandExists('taskkill')) {
    await module.exports.promisifyProcess(
      spawn('taskkill', ['/pid', proc.pid, '/f', '/t']),
      false
    )
  } else {
    proc.kill()
  }
}

function downloadPlaylistFromURL(url) {
  return fetch(url).then(res => res.text())
}

function downloadPlaylistFromLocalPath(path) {
  return readFile(path).then(buf => buf.toString())
}

module.exports.downloadPlaylistFromOptionValue = function(arg) {
  // TODO: Verify things!
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    return downloadPlaylistFromURL(arg)
  } else {
    return downloadPlaylistFromLocalPath(arg)
  }
}
