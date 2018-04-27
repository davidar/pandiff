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

describe('Input formats', function () {
  it('EPUB', test('epub'))
  it('LaTeX', test('tex'))
  it('Markdown', test('md'))
  it('Org mode', test('org'))
  it('reStructuredText', test('rst'))
  it('Textile', test('textile'))
  it('Word', test('docx'))
})

describe('Output formats', function () {
  it('HTML', async function () {
    let text = await pandiff(['', 'test/old.md'], ['', 'test/new.md'],
      {threshold: 0, standalone: true, to: 'html', outputOpts: ['--resource-path=test']})
    expect(text).to.equal(fs.readFileSync('test/diff.html', 'utf8'))
  })
  it('LaTeX', async function () {
    let text = await pandiff(['', 'test/old.md'], ['', 'test/new.md'],
      {threshold: 0, standalone: true, to: 'latex'})
    expect(text).to.equal(fs.readFileSync('test/diff.tex', 'utf8'))
  })
})

describe('Track Changes', function () {
  ['deletion', 'insertion', 'move'].forEach(task => it(task, async function () {
    let output = await pandiff.trackChanges(`test/track_changes_${task}.docx`)
    expect(output).to.equal(fs.readFileSync(`test/track_changes_${task}.md`, 'utf8'))
  }))
})

describe('Misc', function () {
  it('quotes', async function () {
    let output = await pandiff('said “foo bar”', 'said “Foo bar”', {threshold: 0})
    expect(output).to.equal('said “{~~foo~>Foo~~} bar”\n')
  })
})
