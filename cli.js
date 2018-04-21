#!/usr/bin/env node
const pandiff = require('.')

if (process.argv.length < 4) {
  console.error('Usage: pandiff FILE1 FILE2')
} else {
  let [file1, file2] = process.argv.slice(2)
  pandiff(['', file1], ['', file2], {threshold: 0})
    .then(diff => process.stdout.write(diff))
}
