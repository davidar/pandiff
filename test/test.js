/* eslint-env mocha */
const {expect} = require('chai')
const fs = require('fs')

const pandiff = require('..')

const diff = fs.readFileSync('test/diff.md', 'utf8')
const test = ext => async function () {
  let output = await pandiff(['', 'test/old.' + ext], ['', 'test/new.' + ext], {threshold: 0})
  expect(output).to.equal(diff)
}

describe('Basic tests', function () {
  it('Markdown', test('md'))
  it('reStructuredText', test('rst'))
  it('LaTeX', test('tex'))
})
