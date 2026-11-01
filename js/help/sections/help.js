// Help content: Using Help. Rendered by js/pages/help.js.
export default {
  id: 'help',
  title: 'Using Help',
  icon: 'fa-circle-question',
  intro: 'How to find answers in this Help page.',
  articles: [
    {
      id: 'help-search',
      title: 'Find a guide by searching',
      roles: ['admin', 'seller'],
      page: 'help',
      summary: 'Type your question in the search box at the top of Help and open the guide that matches.',
      keywords: ['find', 'question', 'how to', 'tutorial', 'guide', 'search box', 'madad'],
      blocks: [
        { type: 'steps', items: [
          'Click **Help** at the bottom of the menu on the left (on a phone, tap the menu button first).',
          'Type what you want to do in the search box, for example `record sale`, `return stock` or `payment pending`.',
          'The list of guides updates as you type. Click a guide to open it.',
          'Press `Enter` to open the best match straight away.',
        ] },
        { type: 'img', src: 'help-search-results.webp', alt: 'Help search results for the words record sale', caption: 'Search results. Matching words are highlighted in yellow.' },
        { type: 'tip', text: 'Use simple words. "sale", "return", "payment", "party" work better than long sentences.' },
        { type: 'h', text: 'Reading a guide' },
        { type: 'list', items: [
          '**Who can do this** shows whether the task is for admins, sellers or both.',
          '**Open this page** takes you straight to the screen the guide talks about.',
          'Click any screenshot to see it larger.',
          '**Related guides** at the bottom lead to the next thing you will probably need.',
        ] },
        { type: 'img', src: 'help-search-article.webp', alt: 'A Help guide with numbered steps and a screenshot', caption: 'A guide: numbered steps, screenshots and tips.' },
        { type: 'note', text: 'Sellers only see guides for the screens they can use. Admins see every guide.' },
      ],
      related: ['help-browse', 'getting-started-navigate'],
    },
    {
      id: 'help-browse',
      title: 'Browse guides by topic',
      roles: ['admin', 'seller'],
      page: 'help',
      summary: 'Open Help without searching to see every topic and its guides.',
      keywords: ['topics', 'list', 'all guides', 'index', 'contents'],
      blocks: [
        { type: 'steps', items: [
          'Open **Help** from the menu.',
          'Each card is one topic, for example **Daily Operations (Issue & Return)**. Click a guide title, or **See all … guides** to list them all.',
          'On a computer, the list on the left always shows every topic and guide. Click **All topics** to come back to the start.',
        ] },
        { type: 'img', src: 'help-browse-home.webp', alt: 'The Help start page with topic cards', caption: 'The Help start page.' },
        { type: 'tip', text: 'If you open Help from another page, the guides for that page are shown first under **Guides for the page you were on**.' },
        { type: 'tip', text: 'Keyboard users: press `g` then `h` to open Help from anywhere, and `/` to jump to the search box.' },
      ],
      related: ['help-search'],
    },
  ],
};
