// content.js
// Injected into https://chatgpt.com/*

function injectManagerButton() {
  // Check if button already exists
  if (document.getElementById('chatgpt-bulk-manage-btn')) return;

  // Create the button
  const btn = document.createElement('button');
  btn.id = 'chatgpt-bulk-manage-btn';
  btn.innerHTML = `
    <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="7" height="7"></rect>
      <rect x="14" y="3" width="7" height="7"></rect>
      <rect x="14" y="14" width="7" height="7"></rect>
      <rect x="3" y="14" width="7" height="7"></rect>
    </svg>
    ChatGPT Manager
  `;
  
  // Style the button
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    left: '280px', // Default moved slightly right to avoid overlapping the sidebar completely
    zIndex: '9999',
    backgroundColor: '#10a37f', // ChatGPT green
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'grab',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    userSelect: 'none' // Prevent text selection while dragging
  });

  // Make it draggable
  let isDragging = false;
  let hasDragged = false;
  let offsetX, offsetY;

  btn.addEventListener('mousedown', (e) => {
    isDragging = true;
    hasDragged = false;
    offsetX = e.clientX - btn.getBoundingClientRect().left;
    offsetY = e.clientY - btn.getBoundingClientRect().top;
    btn.style.cursor = 'grabbing';
    btn.style.transition = 'none'; // Disable transition during drag
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    hasDragged = true;
    
    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
    
    // Boundary checks to keep it on screen
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - btn.offsetWidth));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - btn.offsetHeight));

    btn.style.left = newLeft + 'px';
    btn.style.top = newTop + 'px';
    btn.style.bottom = 'auto'; // Remove default bottom so top takes precedence
    btn.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      btn.style.cursor = 'grab';
      btn.style.transition = 'background-color 0.2s ease, box-shadow 0.2s ease';
      
      // Save position to localStorage
      localStorage.setItem('chatgpt_bulk_btn_left', btn.style.left);
      localStorage.setItem('chatgpt_bulk_btn_top', btn.style.top);
    }
  });

  // Restore saved position if it exists
  const savedLeft = localStorage.getItem('chatgpt_bulk_btn_left');
  const savedTop = localStorage.getItem('chatgpt_bulk_btn_top');
  if (savedLeft && savedTop) {
    btn.style.left = savedLeft;
    btn.style.top = savedTop;
    btn.style.bottom = 'auto';
  }

  // Hover effects
  btn.addEventListener('mouseenter', () => {
    if (!isDragging) {
      btn.style.backgroundColor = '#0e906f';
      btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
    }
  });
  btn.addEventListener('mouseleave', () => {
    if (!isDragging) {
      btn.style.backgroundColor = '#10a37f';
      btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    }
  });

  // Click event: Tell background script to open dashboard
  btn.addEventListener('click', (e) => {
    // Prevent click from registering if we just dragged it
    if (hasDragged) {
      e.preventDefault();
      return;
    }
    chrome.runtime.sendMessage({ action: 'open_dashboard' });
  });

  document.body.appendChild(btn);
}

// Use a MutationObserver to ensure the button stays injected even if React re-renders the DOM
const observer = new MutationObserver(() => {
  if (!document.getElementById('chatgpt-bulk-manage-btn')) {
    injectManagerButton();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial injection attempt
injectManagerButton();
