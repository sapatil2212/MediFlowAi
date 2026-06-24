const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src');
let changedCount = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content;
  
  newContent = newContent.replace(/className=(['"])(.*?)(['"])/g, (match, p1, p2, p3) => {
    if (p2.includes('bg-brand') && p2.includes('text-white')) {
      let modified = p2.replace(/\bbg-brand\b/g, 'bg-black');
      modified = modified.replace(/\bhover:bg-brand\/[0-9]+\b/g, 'hover:bg-zinc-800');
      modified = modified.replace(/\bborder-brand\b/g, 'border-zinc-800');
      return 'className=' + p1 + modified + p3;
    }
    return match;
  });

  newContent = newContent.replace(/className=\{([\s\S]*?)\}/g, (match, p1) => {
    if (p1.includes('bg-brand') && p1.includes('text-white')) {
      let modified = p1.replace(/\bbg-brand\b/g, 'bg-black');
      modified = modified.replace(/\bhover:bg-brand\/[0-9]+\b/g, 'hover:bg-zinc-800');
      modified = modified.replace(/\bborder-brand\b/g, 'border-zinc-800');
      return 'className={' + modified + '}';
    }
    return match;
  });

  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    changedCount++;
    console.log('Updated: ' + file);
  }
});
console.log('Total files changed: ' + changedCount);
