/* eslint-env mocha */
const {expect} = require('chai')
const fs = require('fs')

const pandiff = require('..')

const diff = fs.readFileSync('test/diff.md', 'utf8')
const test = ext => async function () {
  let args = ['', '--extract-media=/tmp', '--resource-path=test']
  let output = await pandiff(
    [...args, 'test/old.' + ext],
    [...args, 'test/new.' + ext],
    {threshold: 0})
  expect(output).to.equal(diff)
}

describe('Basic tests', function () {
  it('EPUB', test('epub'))
  it('LaTeX', test('tex'))
  it('Markdown', test('md'))
  it('Org mode', test('org'))
  it('reStructuredText', test('rst'))
  it('Textile', test('textile'))
  it('Word', test('docx'))
})

describe('Track Changes', function () {
  ['deletion', 'insertion', 'move'].forEach(task => it(task, async function () {
    let output = await pandiff.trackChanges(`test/track_changes_${task}.docx`)
    expect(output).to.equal(fs.readFileSync(`test/track_changes_${task}.md`, 'utf8'))
  }))
})
