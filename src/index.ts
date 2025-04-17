import {diffLines} from 'diff';
import htmldiff from 'node-htmldiff';
import {JSDOM} from 'jsdom';
import path from 'path';
import wordwrap from 'wordwrap';
import * as sh from 'nodejs-sh';
import fs from 'fs';

interface ArrayLike<T> {
  readonly length: number;
  [item: number]: T;
}

function forEachR<T>(a: ArrayLike<T>, f: (e: T) => void) {
  for (let i = a.length - 1; i >= 0; i--) f(a[i]);
}
function removeNode(node: Node) {
  node.parentNode!.removeChild(node);
}
function removeNodes<T extends Node>(nodes: ArrayLike<T>) {
  forEachR(nodes, removeNode);
}

function diffu(text1: string, text2: string) {
  const result = [] as string[];
  diffLines(text1, text2).forEach(part => {
    let prefix = ' ';
    if (part.removed) prefix = '-';
    if (part.added) prefix = '+';
    let chunk = part.value;
    if (chunk[chunk.length - 1] === '\n') chunk = chunk.slice(0, -1);
    for (const line of chunk.split('\n')) result.push(prefix + line);
  });
  return result.join('\n');
}

function postprocess(html: string) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // handle math
  forEachR(document.querySelectorAll('span.math.inline'), math => {
    math.innerHTML = '\\(' + math.innerHTML + '\\)';
  });
  forEachR(document.querySelectorAll('span.math.display'), math => {
    math.innerHTML = '\\[' + math.innerHTML + '\\]';
  });
  forEachR(document.querySelectorAll('span.math'), math => {
    const post = math.cloneNode(true) as Element;
    removeNodes(math.getElementsByTagName('ins'));
    removeNodes(post.getElementsByTagName('del'));
    math.textContent = math.textContent; post.textContent = post.textContent // eslint-disable-line
    if (math.textContent === post.textContent) return;
    math.innerHTML =
      '<del>' + math.innerHTML + '</del><ins>' + post.innerHTML + '</ins>';
  });

  // strip style attributes from images
  forEachR(document.getElementsByTagName('img'), img => {
    if (img.hasAttribute('style')) {
      img.removeAttribute('style');
    }
  });

  // strip any pre-existing spans or divs
  let span: Element | null;
  while ((span = document.querySelector('span,div,section'))) {
    if (['insertion', 'deletion'].includes(span.className)) {
      const tag = span.className.slice(0, 3);
      span.outerHTML = `<${tag}>${span.innerHTML}</${tag}>`;
    } else {
      span.outerHTML = span.innerHTML;
    }
  }

  // fix figures with modified images
  forEachR(document.getElementsByTagName('figure'), figure => {
    const imgs = figure.getElementsByTagName('img');
    if (imgs.length > 1) {
      // Find the deleted and inserted images
      const deletedImgs = figure.querySelectorAll('del img, img:not(ins img)');
      const insertedImgs = figure.querySelectorAll('ins img');

      // Get the figure caption text
      const figcaption = figure.querySelector('figcaption');
      const captionText = figcaption
        ? figcaption.textContent || 'image'
        : 'image';

      // Create replacement elements
      const container = document.createElement('div');

      // Add deleted images with del tags
      if (deletedImgs.length > 0) {
        const img = deletedImgs[0] as HTMLImageElement;
        const delEl = document.createElement('del');
        const imgEl = document.createElement('img');
        imgEl.src = img.src;
        imgEl.alt = captionText;
        delEl.appendChild(imgEl);
        container.appendChild(delEl);

        // Add a proper paragraph break if both deleted and inserted images exist
        if (insertedImgs.length > 0) {
          // Using a proper block element like p to create a new paragraph in markdown
          const breakEl = document.createElement('p');
          container.appendChild(breakEl);
        }
      }

      // Add inserted images with ins tags
      if (insertedImgs.length > 0) {
        const img = insertedImgs[0] as HTMLImageElement;
        const insEl = document.createElement('ins');
        const imgEl = document.createElement('img');
        imgEl.src = img.src;
        imgEl.alt = captionText;
        insEl.appendChild(imgEl);
        container.appendChild(insEl);
      }

      // Replace the figure with our container's contents
      figure.outerHTML = container.innerHTML;
    }
  });

  // compact lists
  forEachR(document.querySelectorAll('li>p:only-child'), par => {
    par.outerHTML = par.innerHTML;
  });

  // redundant title attributes
  forEachR(document.getElementsByTagName('img'), image => {
    if (image.title && image.title === image.alt)
      image.removeAttribute('title');
  });

  // line by line diff of code blocks
  forEachR(document.getElementsByTagName('pre'), pre => {
    const post = pre.cloneNode(true) as Element;
    removeNodes(pre.getElementsByTagName('ins'));
    removeNodes(post.getElementsByTagName('del'));
    if (pre.textContent === post.textContent) return;
    pre.className = 'diff';
    pre.textContent = diffu(pre.textContent || '', post.textContent || '');
  });

  // turn diff tags into spans
  forEachR(document.getElementsByTagName('del'), del => {
    del.outerHTML = '<span class="del">' + del.innerHTML + '</span>';
  });
  forEachR(document.getElementsByTagName('ins'), ins => {
    ins.outerHTML = '<span class="ins">' + ins.innerHTML + '</span>';
  });

  // pull diff tags outside inline tags when possible
  const inlineTags = new Set(['a', 'code', 'em', 'q', 'strong', 'sub', 'sup']);
  forEachR(document.getElementsByTagName('span'), span => {
    const content = span.innerHTML;
    const par = span.parentNode as Element;
    if (
      par &&
      par.childNodes.length === 1 &&
      inlineTags.has(par.tagName.toLowerCase())
    ) {
      par.innerHTML = content;
      par.outerHTML = `<span class="${span.className}">${par.outerHTML}</span>`;
    }
  });

  // merge adjacent diff tags
  forEachR(document.getElementsByTagName('span'), span => {
    const next = span.nextSibling as Element;
    if (next && span.className === next.className) {
      span.innerHTML += next.innerHTML;
      removeNode(next);
    }
  });

  // split completely rewritten paragraphs
  forEachR(document.getElementsByTagName('p'), para => {
    const ch = para.childNodes as NodeListOf<Element>;
    if (
      ch.length === 2 &&
      ch[0].className === 'del' &&
      ch[1].className === 'ins'
    ) {
      para.outerHTML =
        '<p>' + ch[0].outerHTML + '</p><p>' + ch[1].outerHTML + '</p>';
    }
  });

  // identify substitutions
  forEachR(document.getElementsByTagName('span'), span => {
    const next = span.nextSibling as Element;
    if (next && span.className === 'del' && next.className === 'ins') {
      span.outerHTML =
        '<span class="sub">' + span.outerHTML + next.outerHTML + '</span>';
      removeNode(next);
    }
  });
  return dom.serialize();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildArgs(opts: Record<string, any>, ...params: string[]) {
  const args = [] as string[];
  for (const param of params) {
    if (param in opts) {
      const opt = opts[param];
      if (typeof opt === 'boolean') {
        if (opt === true) args.push(`--${param}`);
      } else if (Array.isArray(opt)) {
        for (const val of opt) {
          args.push(`--${param}=${val}`);
        }
      } else {
        args.push(`--${param}=${opt}`);
      }
    }
  }
  return args;
}

async function convert(source: string, opts: pandiff.Options = {}) {
  const args = buildArgs(
    opts,
    'bibliography',
    'csl',
    'extract-media',
    'filter',
    'from',
    'lua-filter',
    'mathjax',
    'mathml',
    'resource-path'
  );
  args.push('--html-q-tags', '--mathjax');
  let html;
  if (opts.files) {
    if (source === '-') {
      const stdinContent = fs.readFileSync(0, 'utf8');
      html = await sh
        .pandoc(...args)
        .end(stdinContent)
        .toString();
    } else {
      html = await sh.pandoc(...args, source).toString();
    }
  } else {
    html = await sh
      .pandoc(...args)
      .end(source)
      .toString();
  }
  html = html.replace(/\\[()[\]]/g, '');
  if ('extract-media' in opts)
    html = await sh
      .pandoc(...args, '--from=html')
      .end(html)
      .toString();
  html = new JSDOM(html).serialize();
  return html;
}

async function extractMetadata(source: string) {
  const file = fs.readFileSync(source, 'utf8');
  const lines = file.split('\n');
  if (lines[0].trim() !== '---') return '';

  const metadata = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    metadata.push(lines[i]);
    if (lines[i].trim() === '---') break;
  }

  return metadata.join('\n');
}

async function pandiff(
  source1: string,
  source2: string,
  opts: pandiff.Options = {}
): Promise<string | null> {
  let metadata = '';
  switch (opts.metadata) {
    case 'old':
      metadata = await extractMetadata(source1);
      break;
    case 'new':
      metadata = await extractMetadata(source2);
      break;
    default:
      break;
  }
  const html1 = await convert(source1, opts);
  const html2 = await convert(source2, opts);
  const html = htmldiff(html1, html2);

  const unmodified = html
    .replace(/<del.*?del>/g, '')
    .replace(/<ins.*?ins>/g, '');
  const similarity = unmodified.length / html.length;
  if (opts.threshold && similarity < opts.threshold) {
    console.error(
      Math.round(100 - 100 * similarity) + '% of the content has changed'
    );
    return null;
  } else {
    return render(html, opts, metadata);
  }
}

const markdown = [
  'markdown',
  '-bracketed_spans',
  '-fenced_code_attributes',
  '-fenced_divs',
  '-grid_tables',
  '-header_attributes',
  '-inline_code_attributes',
  '-link_attributes',
  '-multiline_tables',
  '-pipe_tables',
  '-raw_attribute',
  '-simple_tables',
  '-smart',
].join('');

const regex = {
  critic: {
    del: /\{--([\s\S]*?)--\}/g,
    ins: /\{\+\+([\s\S]*?)\+\+\}/g,
    sub: /\{~~((?:[^~]|(?:~(?!>)))+)~>((?:[^~]|(?:~(?!~\})))+)~~\}/g,
  },
  span: {
    del: /<span class="del">([\s\S]*?)<\/span>/g,
    ins: /<span class="ins">([\s\S]*?)<\/span>/g,
    sub: /<span class="sub"><span class="del">([\s\S]*?)<\/span><span class="ins">([\s\S]*?)<\/span><\/span>/g,
  },
  div: {
    del: /<div class="del">\s*([\s\S]*?)\s*<\/div>/g,
    ins: /<div class="ins">\s*([\s\S]*?)\s*<\/div>/g,
  },
};

async function render(html: string, opts: pandiff.Options = {}, metadata = '') {
  html = postprocess(html);
  const args = buildArgs(opts, 'reference-links');
  args.push('--wrap=none');

  let output = await sh
    .pandoc('-f', 'html+tex_math_single_backslash', '-t', markdown)
    .end(html)
    .toString();
  output = await sh
    .pandoc(...args, '-t', markdown)
    .end(output)
    .toString();
  output = output
    .replace(regex.span.sub, '{~~$1~>$2~~}')
    .replace(regex.span.del, '{--$1--}')
    .replace(regex.span.ins, '{++$1++}')
    .replace(regex.div.del, '{--$1--}')
    .replace(regex.div.ins, '{++$1++}');

  const lines = [] as string[];
  let pre = false;
  for (const line of output.split('\n')) {
    const lastLineLen = lines.length > 0 ? lines[lines.length - 1].length : 0;
    if (line.startsWith('```')) pre = !pre;
    if (pre || line.startsWith('  [')) {
      lines.push(line);
    } else if (line.match(/^[=-]+$/) && lastLineLen > 0) {
      lines.push(line.slice(0, lastLineLen));
    } else if (opts.wrap !== 'none') {
      for (const wrapped of wordwrap(opts.columns || 72)(line).split('\n')) {
        lines.push(wrapped);
      }
    } else {
      lines.push(line);
    }
  }
  const text = lines.join('\n');
  return postrender(text, opts, metadata);
}

const criticHTML = (text: string) =>
  text
    .replace(regex.critic.del, '<del>$1</del>')
    .replace(regex.critic.ins, '<ins>$1</ins>')
    .replace(regex.critic.sub, '<del>$1</del><ins>$2</ins>');

const criticLaTeX = (text: string) =>
  text
    .replace(
      regex.critic.del,
      '<span>\\color{Maroon}~~<span>$1</span>~~</span>'
    )
    .replace(regex.critic.ins, '<span>\\color{OliveGreen}$1</span>')
    .replace(
      regex.critic.sub,
      '<span>\\color{RedOrange}~~<span>$1</span>~~<span>$2</span></span>'
    );

const criticTrackChanges = (text: string) =>
  text
    .replace(regex.critic.del, '<span class="deletion">$1</span>')
    .replace(regex.critic.ins, '<span class="insertion">$1</span>')
    .replace(
      regex.critic.sub,
      '<span class="deletion">$1</span><span class="insertion">$2</span>'
    );

const criticReject = (text: string) =>
  text
    .replace(regex.critic.del, '$1')
    .replace(regex.critic.ins, '')
    .replace(regex.critic.sub, '$1');
const criticAccept = (text: string) =>
  text
    .replace(regex.critic.del, '')
    .replace(regex.critic.ins, '$1')
    .replace(regex.critic.sub, '$2');

const pandocOptionsHTML = [
  '--css',
  require.resolve('github-markdown-css'),
  '--css',
  require.resolve('../assets/pandiff.css'),
  '--variable',
  'include-before=<article class="markdown-body">',
  '--variable',
  'include-after=</article>',
  '--embed-resources',
  '--standalone',
];

async function postrender(
  text: string,
  opts: pandiff.Options = {},
  metadata = ''
) {
  if (!opts.output && !opts.to) return text;

  if (!('highlight-style' in opts)) opts['highlight-style'] = 'kate';
  let args = buildArgs(
    opts,
    'highlight-style',
    'output',
    'template',
    'pdf-engine',
    'metadata-file',
    'reference-doc',
    'resource-path',
    'standalone',
    'to'
  );
  const outputExt = opts.output ? path.extname(opts.output) : null;
  if (outputExt === '.pdf') opts.standalone = true;

  if (opts.to === 'latex' || outputExt === '.tex' || outputExt === '.pdf') {
    text = criticLaTeX(text);
    args.push('--variable', 'colorlinks=true');
  } else if (opts.to === 'docx' || outputExt === '.docx') {
    text = criticTrackChanges(text);
  } else if (opts.to === 'html' || outputExt === '.html') {
    text = criticHTML(text);
    const paras = text
      .split('\n\n')
      .map(p =>
        p.startsWith('<ins>') || p.startsWith('<del>') ? '<p>' + p + '</p>' : p
      );
    text = paras.join('\n\n');
    if (opts.standalone) args = args.concat(pandocOptionsHTML);
  }

  if (opts.output) {
    await sh.pandoc(...args).end(`${metadata}\n${text}`);
    return null;
  } else {
    return sh
      .pandoc(...args)
      .end(text)
      .toString();
  }
}

export = pandiff;
namespace pandiff { // eslint-disable-line
  export type File = string;
  export type Format = string;
  export type Path = string;
  export interface Options {
    bibliography?: File[];
    columns?: number;
    'extract-media'?: Path;
    filter?: string[];
    from?: Format;
    help?: boolean;
    'highlight-style'?: string;
    'lua-filter'?: File[];
    template?: string;
    output?: File;
    'pdf-engine'?: string;
    'reference-links'?: boolean;
    'metadata-file'?: File;
    'reference-doc'?: File;
    'resource-path'?: Path;
    standalone?: boolean;
    threshold?: number;
    to?: Format;
    version?: boolean;
    wrap?: 'auto' | 'none' | 'preserve';
    files?: boolean;
    metadata?: 'new' | 'old' | 'none';
  }
  /* eslint-disable no-inner-declarations */
  export async function trackChanges(
    file: string,
    opts: Options = {}
  ): Promise<string | null> {
    const html = await sh.pandoc(file, '--track-changes=all').toString();
    return render(html, opts);
  }
  export function normalise(
    text: string,
    opts: Options = {}
  ): Promise<string | null> {
    return pandiff(criticReject(text), criticAccept(text), opts);
  }
}
