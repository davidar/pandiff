const {diffLines} = require('diff')
const htmldiff = require('node-htmldiff')
const {JSDOM} = require('jsdom')
const {pandoc} = require('nodejs-sh')
const wordwrap = require('wordwrap')

const forEachR = (a, f) => { for (let i = a.length - 1; i >= 0; i--) f(a[i]) }
const removeNode = node => node.parentNode.removeChild(node)
const removeNodes = nodes => forEachR(nodes, removeNode)

function diffu (text1, text2) {
  let result = []
  diffLines(text1, text2).forEach(part => {
    let prefix = ' '
    if (part.removed) prefix = '-'
    if (part.added) prefix = '+'
    let chunk = part.value
    if (chunk[chunk.length - 1] === '\n') chunk = chunk.slice(0, -1)
    for (const line of chunk.split('\n')) result.push(prefix + line)
  })
  return result.join('\n')
}

function postprocess (html) {
  let dom = new JSDOM(html)
  let document = dom.window.document

  // strip any pre-existing spans
  for (let span; (span = document.querySelector('span'));) {
    span.outerHTML = span.innerHTML
  }

  // strip figures
  removeNodes(document.getElementsByTagName('figcaption'))
  forEachR(document.getElementsByTagName('figure'), figure => {
    figure.outerHTML = '<p>' + figure.innerHTML.trim() + '</p>'
  })

  // compact lists
  forEachR(document.querySelectorAll('li>p:only-child'), par => {
    par.outerHTML = par.innerHTML
  })

  // line by line diff of code blocks
  forEachR(document.getElementsByTagName('pre'), pre => {
    let post = pre.cloneNode(true)
    removeNodes(pre.getElementsByTagName('ins'))
    removeNodes(post.getElementsByTagName('del'))
    pre.className = 'diff'
    pre.textContent = diffu(pre.textContent, post.textContent)
  })

  // turn diff tags into spans
  forEachR(document.getElementsByTagName('del'), del => {
    del.outerHTML = '<span class="del">' + del.innerHTML + '</span>'
  })
  forEachR(document.getElementsByTagName('ins'), ins => {
    ins.outerHTML = '<span class="ins">' + ins.innerHTML + '</span>'
  })

  // pull diff tags outside inline tags when possible
  const inlineTags = new Set(['a', 'code', 'em', 'strong', 'sub', 'sup'])
  forEachR(document.getElementsByTagName('span'), span => {
    let content = span.innerHTML
    let par = span.parentNode
    if (par && par.childNodes.length === 1 && inlineTags.has(par.tagName.toLowerCase())) {
      par.innerHTML = content
      par.outerHTML = '<span class="' + span.className + '">' + par.outerHTML + '</span>'
    }
  })

  // merge adjacent diff tags
  forEachR(document.getElementsByTagName('span'), span => {
    let next = span.nextSibling
    if (next && span.className === next.className) {
      span.innerHTML += next.innerHTML
      removeNode(next)
    }
  })

  // split completely rewritten paragraphs
  forEachR(document.getElementsByTagName('p'), para => {
    let ch = para.childNodes
    if (ch.length === 2 && ch[0].className === 'del' && ch[1].className === 'ins') {
      para.outerHTML = '<p>' + ch[0].outerHTML + '</p><p>' + ch[1].outerHTML + '</p>'
    }
  })

  // identify substitutions
  forEachR(document.getElementsByTagName('span'), span => {
    let next = span.nextSibling
    if (next && span.className === 'del' && next.className === 'ins') {
      span.outerHTML = '<span class="sub">' + span.outerHTML + next.outerHTML + '</span>'
      removeNode(next)
    }
  })
  return dom.serialize()
}

async function pandiff (text1, text2, {threshold = 0.5, wrap = 72} = {}) {
  let args1 = []
  if (text1 instanceof Array) {
    args1 = text1.slice(1)
    text1 = text1[0]
  }
  let args2 = []
  if (text2 instanceof Array) {
    args2 = text2.slice(1)
    text2 = text2[0]
  }

  let html = htmldiff(
    await pandoc(...args1).end(text1).toString(),
    await pandoc(...args2).end(text2).toString())
  let unmodified = html.replace(/<del.*?del>/g, '').replace(/<ins.*?ins>/g, '')
  let similarity = unmodified.length / html.length
  if (similarity < threshold) {
    console.error(Math.round(100 - 100 * similarity) + '% of the content has changed')
    return null
  }

  let markdown = [
    'markdown',
    '-bracketed_spans',
    '-fenced_code_attributes',
    '-fenced_divs',
    '-header_attributes',
    '-inline_code_attributes',
    '-link_attributes',
    '-native_divs',
    '-raw_html',
    '-smart'
  ].join('')

  html = postprocess(html)
  let output = await pandoc('-f', 'html', '-t', markdown,
    '--reference-links', '--wrap=none').end(html).toString()
  output = output
    .replace(/<span class="sub"><span class="del">([\s\S]*?)<\/span><span class="ins">([\s\S]*?)<\/span><\/span>/g, '{~~$1~>$2~~}')
    .replace(/<span class="del">([\s\S]*?)<\/span>/g, '{--$1--}')
    .replace(/<span class="ins">([\s\S]*?)<\/span>/g, '{++$1++}')

  if (wrap) {
    let lines = []
    let pre = false
    for (const line of output.split('\n')) {
      let lastLineLen = lines.length > 0 ? lines[lines.length - 1].length : 0
      if (line.startsWith('```')) pre = !pre
      if (pre || line.startsWith('  [')) {
        lines.push(line)
      } else if (line.match(/^[=-]+$/) && lastLineLen > 0) {
        lines.push(line.slice(0, lastLineLen))
      } else {
        for (const wrapped of wordwrap(wrap)(line).split('\n')) {
          lines.push(wrapped)
        }
      }
    }
    output = lines.join('\n')
  }

  return output
}

module.exports = pandiff
