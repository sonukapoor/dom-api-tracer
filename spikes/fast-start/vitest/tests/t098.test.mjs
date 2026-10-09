import { test, expect } from 'vitest';

test('builds and queries a small tree', () => {
  const ul = document.createElement('ul');
  for (let i = 0; i < 20; i++) {
    const li = document.createElement('li');
    li.setAttribute('class', i % 2 ? 'odd' : 'even');
    li.textContent = `item ${i}`;
    ul.appendChild(li);
  }
  document.body.appendChild(ul);
  let clicks = 0;
  ul.addEventListener('click', () => clicks++);
  ul.querySelector('li').dispatchEvent(new Event('click', { bubbles: true }));
  expect(document.querySelectorAll('li').length).toBe(20);
  expect(ul.querySelector('.odd').textContent).toBe('item 1');
  expect(clicks).toBe(1);
});
