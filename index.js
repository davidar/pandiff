const {diffLines} = require('diff')
const htmldiff = require('node-htmldiff')
const {JSDOM} = require('jsdom')
const {pandoc} = require('nodejs-sh')
const path = require('path')
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
    if (['insertion', 'deletion'].includes(span.className)) {
      let tag = span.className.slice(0, 3)
      span.outerHTML = `<${tag}>${span.innerHTML}</${tag}>`
    } else {
      span.outerHTML = span.innerHTML
    }
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

  // redundant title attributes
  forEachR(document.getElementsByTagName('img'), image => {
    if (image.title && image.title === image.alt) image.removeAttribute('title')
  })

  // line by line diff of code blocks
  forEachR(document.getElementsByTagName('pre'), pre => {
    let post = pre.cloneNode(true)
    removeNodes(pre.getElementsByTagName('ins'))
    removeNodes(post.getElementsByTagName('del'))
    if (pre.textContent === post.textContent) return
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
  const inlineTags = new Set(['a', 'code', 'em', 'q', 'strong', 'sub', 'sup'])
  forEachR(document.getElementsByTagName('span'), span => {
    let content = span.innerHTML
    let par = span.parentNode
    if (par && par.childNodes.length === 1 && inlineTags.has(par.tagName.toLowerCase())) {
      par.innerHTML = content
      par.outerHTML = `<span class="${span.className}">${par.outerHTML}</span>`
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

function buildArgs (opts, ...params) {
  let args = []
  for (const param of params) {
    if (param in opts) {
      if (typeof opts[param] === 'boolean') {
        if (opts[param] === true) args.push(`--${param}`)
      } else {
        args.push(`--${param}=${opts[param]}`)
      }
    }
  }
  return args
}

async function convert (source, opts = {}) {
  let args = buildArgs(opts, 'extract-media', 'from', 'resource-path')
  args.push('--html-q-tags')
  let html
  if (opts.files) {
    html = await pandoc(...args, source).toString()
  } else {
    html = await pandoc(...args).end(source).toString()
  }
  if ('extract-media' in opts) html = await pandoc(...args, '--from=html').end(html).toString()
  return html
}

async function pandiff (source1, source2, opts = {}) {
  let html1 = await convert(source1, opts)
  let html2 = await convert(source2, opts)
  let html = htmldiff(html1, html2)

  let unmodified = html.replace(/<del.*?del>/g, '').replace(/<ins.*?ins>/g, '')
  let similarity = unmodified.length / html.length
  if (opts.threshold && similarity < opts.threshold) {
    console.error(Math.round(100 - 100 * similarity) + '% of the content has changed')
    return null
  } else {
    let text = await render(html, opts)
    return postrender(text, opts)
  }
}

const markdown = [
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

const regex = {
  critic: {
    del: /\{--([\s\S]*?)--\}/g,
    ins: /\{\+\+([\s\S]*?)\+\+\}/g,
    sub: /\{~~((?:[^~]|(?:~(?!>)))+)~>((?:[^~]|(?:~(?!~\})))+)~~\}/g
  },
  span: {
    del: /<span class="del">([\s\S]*?)<\/span>/g,
    ins: /<span class="ins">([\s\S]*?)<\/span>/g,
    sub: /<span class="sub"><span class="del">([\s\S]*?)<\/span><span class="ins">([\s\S]*?)<\/span><\/span>/g
  }
}

async function render (html, opts = {}) {
  html = postprocess(html)

  let args = buildArgs(opts, 'atx-headers', 'reference-links')
  args.push('--wrap=none')

  let output = await pandoc('-f', 'html', '-t', markdown).end(html).toString()
  output = await pandoc(...args, '-t', markdown).end(output).toString()
  output = output
    .replace(regex.span.sub, '{~~$1~>$2~~}')
    .replace(regex.span.del, '{--$1--}')
    .replace(regex.span.ins, '{++$1++}')

  let {wrap = 72} = opts
  let lines = []
  let pre = false
  for (const line of output.split('\n')) {
    let lastLineLen = lines.length > 0 ? lines[lines.length - 1].length : 0
    if (line.startsWith('```')) pre = !pre
    if (pre || line.startsWith('  [')) {
      lines.push(line)
    } else if (line.match(/^[=-]+$/) && lastLineLen > 0) {
      lines.push(line.slice(0, lastLineLen))
    } else if (wrap) {
      for (const wrapped of wordwrap(wrap)(line).split('\n')) {
        lines.push(wrapped)
      }
    } else {
      lines.push(line)
    }
  }
  return lines.join('\n')
}

const criticHTML = text => text
  .replace(regex.critic.del, '<del>$1</del>')
  .replace(regex.critic.ins, '<ins>$1</ins>')
  .replace(regex.critic.sub, '<del>$1</del><ins>$2</ins>')

const criticLaTeX = text => '\\useunder{\\uline}{\\ulined}{}\n' + text
  .replace(regex.critic.del, '<span>\\color{Maroon}~~<span>$1</span>~~</span>')
  .replace(regex.critic.ins, '<span>\\color{OliveGreen}\\ulined{}$1</span>')
  .replace(regex.critic.sub, '<span>\\color{RedOrange}~~<span>$1</span>~~<span>\\ulined{}$2</span></span>')

const criticTrackChanges = text => text
  .replace(regex.critic.del, '<span class="deletion">$1</span>')
  .replace(regex.critic.ins, '<span class="insertion">$1</span>')
  .replace(regex.critic.sub, '<span class="deletion">$1</span><span class="insertion">$2</span>')

const pandocOptionsHTML = [
  '--css', path.join(__dirname, 'node_modules/github-markdown-css/github-markdown.css'),
  '--css', path.join(__dirname, 'pandiff.css'),
  '--variable', 'include-before=<article class="markdown-body">',
  '--variable', 'include-after=</article>',
  '--self-contained'
]

async function postrender (text, opts = {}) {
  if (!opts.output && !opts.to) return text

  if (!('highlight-style' in opts)) opts['highlight-style'] = 'kate'
  let args = buildArgs(opts, 'highlight-style', 'output', 'resource-path', 'standalone', 'to')
  let outputExt = opts.output ? path.extname(opts.output) : null
  if (outputExt === '.pdf') opts.standalone = true

  if (opts.to === 'latex' || outputExt === '.tex' || outputExt === '.pdf') {
    text = criticLaTeX(text)
    args.push('--variable', 'colorlinks=true')
  } else if (opts.to === 'docx' || outputExt === '.docx') {
    text = criticTrackChanges(text)
  } else if (opts.to === 'html' || outputExt === '.html') {
    text = criticHTML(text)
    if (opts.standalone) args = args.concat(pandocOptionsHTML)
  }

  if (opts.output) {
    await pandoc(...args).end(text)
    return null
  } else {
    return pandoc(...args).end(text).toString()
  }
}

module.exports = pandiff
module.exports.trackChanges = (file, opts = {}) =>
  pandoc(file, '--track-changes=all').toString().then(render).then(text => postrender(text, opts))
