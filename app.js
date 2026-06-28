const OPDS = (() => {
  const state = {
    rootUrl: '',
    currentUrl: '',
    history: [],
    entries: [],
    navigation: [],
    searchTemplate: null,
    currentPage: 0,
    totalResults: 0,
    itemsPerPage: 0,
    selfUrl: '',
  };

  const NS = {
    atom: 'http://www.w3.org/2005/Atom',
    opds: 'http://opds-spec.org/2010/catalog',
    dcterms: 'http://purl.org/dc/terms/',
    opensearch: 'http://a9.com/-/spec/opensearch/1.1/',
    app: 'http://www.w3.org/2007/app',
    thr: 'http://purl.org/syndication/thread/1.0',
  };

  function getXmlNs(nsMap, prefix) {
    return nsMap[prefix] || '';
  }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }

  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function getText(el, tag, ns) {
    if (!el) return '';
    const nodes = ns
      ? el.getElementsByTagNameNS(ns, tag)
      : el.getElementsByTagName(tag);
    return nodes.length > 0 ? (nodes[0].textContent || '').trim() : '';
  }

  function getAttr(el, tag, attr, ns) {
    if (!el) return '';
    const nodes = ns
      ? el.getElementsByTagNameNS(ns, tag)
      : el.getElementsByTagName(tag);
    if (nodes.length === 0) return '';
    return nodes[0].getAttribute(attr) || '';
  }

  function getAllText(el, tag, ns) {
    if (!el) return [];
    const nodes = ns
      ? el.getElementsByTagNameNS(ns, tag)
      : el.getElementsByTagName(tag);
    return Array.from(nodes).map(n => (n.textContent || '').trim()).filter(Boolean);
  }

  function getLinks(el, rel) {
    const links = el.getElementsByTagNameNS(NS.atom, 'link');
    return Array.from(links).filter(l => l.getAttribute('rel') === rel);
  }

  function getLinkHref(el, rel) {
    const links = getLinks(el, rel);
    return links.length > 0 ? (links[0].getAttribute('href') || '') : '';
  }

  function buildUrl(base, href) {
    if (!href) return '';
    try {
      return new URL(href, base).href;
    } catch {
      return href;
    }
  }

  function resolveUrl(url) {
    return buildUrl(state.currentUrl, url);
  }

  function getFeedUrl() {
    return $('#feed-url').value.trim();
  }

  function getProxyUrl() {
    const proxy = $('#proxy-select').value;
    return proxy;
  }

  function proxyWrap(url) {
    const proxy = getProxyUrl();
    if (!proxy) return url;
    return proxy + encodeURIComponent(url);
  }

  function showLoading(show) {
    $('#loading').classList.toggle('hidden', !show);
    $('#content').classList.toggle('hidden', show);
    if (show) $('#content').innerHTML = '';
  }

  function showError(msg) {
    const el = $('#error');
    if (msg) {
      el.innerHTML = msg;
      el.classList.remove('hidden');
      $('#content').classList.add('hidden');
    } else {
      el.classList.add('hidden');
      $('#content').classList.remove('hidden');
    }
  }

  function setSearchVisible(show) {
    $('#search-bar').classList.toggle('hidden', !show);
  }

  async function fetchXml(url) {
    const proxyUrl = getProxyUrl();
    const fetchTarget = proxyUrl ? proxyUrl + encodeURIComponent(url) : url;

    const resp = await fetch(fetchTarget, {
      headers: { 'Accept': 'application/atom+xml, application/xml, text/xml, */*' },
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const text = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    const parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      throw new Error('Failed to parse XML response');
    }

    return doc;
  }

  function parseFeed(doc) {
    const root = doc.documentElement;
    const title = getText(root, 'title', NS.atom) || 'Untitled';
    const subtitle = getText(root, 'subtitle', NS.atom);
    const total = parseInt(getText(root, 'totalResults', NS.opensearch), 10);
    const itemsPerPage = parseInt(getText(root, 'itemsPerPage', NS.opensearch), 10);
    const startIndex = parseInt(getText(root, 'startIndex', NS.opensearch), 10);

    if (!isNaN(total)) state.totalResults = total;
    if (!isNaN(itemsPerPage)) state.itemsPerPage = itemsPerPage;
    if (!isNaN(startIndex)) state.currentPage = Math.floor(startIndex / itemsPerPage) || 0;

    const entries = [];
    const navigation = [];
    const feedEntries = root.getElementsByTagNameNS(NS.atom, 'entry');

    Array.from(feedEntries).forEach(entry => {
      const entryType = detectEntryType(entry);

      if (entryType === 'navigation') {
        navigation.push(parseNavigationEntry(entry));
      } else if (entryType === 'acquisition') {
        entries.push(parseAcquisitionEntry(entry));
      } else {
        const rel = getLinkHref(entry, 'subsection') ? 'navigation' : 'acquisition';
        if (rel === 'navigation') {
          navigation.push(parseNavigationEntry(entry));
        } else {
          entries.push(parseAcquisitionEntry(entry));
        }
      }
    });

    const searchLink = getLinkHref(root, 'search');
    const searchTemplate = searchLink ? resolveUrl(searchLink) : null;

    const selfLink = getLinkHref(root, 'self');
    if (selfLink) state.selfUrl = resolveUrl(selfLink);

    const nextLink = getLinkHref(root, 'next');
    const prevLink = getLinkHref(root, 'previous');
    const paginationLinks = {};
    if (nextLink) paginationLinks.next = resolveUrl(nextLink);
    if (prevLink) paginationLinks.prev = resolveUrl(prevLink);

    return { title, subtitle, entries, navigation, searchTemplate, paginationLinks };
  }

  function detectEntryType(entry) {
    const links = entry.getElementsByTagNameNS(NS.atom, 'link');
    for (const link of Array.from(links)) {
      const rel = link.getAttribute('rel') || '';
      if (rel === 'subsection' || rel === 'http://opds-spec.org/subsection') {
        return 'navigation';
      }
      if (rel.startsWith('http://opds-spec.org/acquisition') || rel === 'http://opds-spec.org/acquisition') {
        return 'acquisition';
      }
    }
    const href = getLinkHref(entry, 'subsection');
    if (href) return 'navigation';
    return 'unknown';
  }

  function parseNavigationEntry(entry) {
    const title = getText(entry, 'title', NS.atom) || 'Untitled';
    const href = resolveUrl(getLinkHref(entry, 'subsection'));
    const summary = getText(entry, 'summary', NS.atom) || getText(entry, 'content', NS.atom) || '';

    return { type: 'navigation', title, href, summary };
  }

  function parseAcquisitionEntry(entry) {
    const id = getText(entry, 'id', NS.atom) || '';
    const title = getText(entry, 'title', NS.atom) || 'Untitled';
    const authors = getAllText(entry, 'author', NS.atom).length > 0
      ? Array.from(entry.getElementsByTagNameNS(NS.atom, 'author')).map(a => getText(a, 'name', NS.atom))
      : getAllText(entry, 'creator', NS.dcterms);
    const summary = getText(entry, 'summary', NS.atom) || getText(entry, 'content', NS.atom) || '';
    const published = getText(entry, 'published', NS.atom) || '';
    const updated = getText(entry, 'updated', NS.atom) || '';
    const language = getText(entry, 'language', NS.dcterms) || '';
    const categories = Array.from(entry.getElementsByTagNameNS(NS.atom, 'category'))
      .map(c => c.getAttribute('term') || c.getAttribute('label') || '')
      .filter(Boolean);

    const cover = resolveUrl(getLinkHref(entry, 'http://opds-spec.org/cover')
      || getLinkHref(entry, 'http://opds-spec.org/image')
      || getLinkHref(entry, 'http://opds-spec.org/image-thumbnail'));

    const thumbnail = resolveUrl(getLinkHref(entry, 'http://opds-spec.org/image-thumbnail')
      || getLinkHref(entry, 'http://opds-spec.org/cover'));

    const downloads = [];
    const links = entry.getElementsByTagNameNS(NS.atom, 'link');
    Array.from(links).forEach(link => {
      const rel = link.getAttribute('rel') || '';
      if (rel.startsWith('http://opds-spec.org/acquisition')) {
        downloads.push({
          href: resolveUrl(link.getAttribute('href') || ''),
          type: link.getAttribute('type') || 'application/octet-stream',
          rel: rel,
        });
      }
    });

    const entrySelf = resolveUrl(getLinkHref(entry, 'self'));
    const alternate = resolveUrl(getLinkHref(entry, 'alternate'));

    return {
      type: 'acquisition',
      id, title, authors, summary,
      published, updated, language, categories,
      cover, thumbnail, downloads,
      links: { self: entrySelf, alternate },
    };
  }

  function renderBreadcrumb() {
    const el = $('#breadcrumb');
    const parts = [{ title: 'Home', url: state.rootUrl || '/' }];

    state.history.forEach((h, i) => {
      if (i === 0 && h.title === state.rootUrl) return;
      parts.push(h);
    });

    if (parts.length === 1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    el.innerHTML = parts.map((p, i) => {
      const isLast = i === parts.length - 1;
      if (isLast) {
        return `<span class="current">${escapeHtml(p.title)}</span>`;
      }
      return `<a href="#" data-url="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a><span class="sep">/</span>`;
    }).join('');

    $$('#breadcrumb a').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const url = a.dataset.url;
        const idx = state.history.findIndex(h => h.url === url);
        if (idx >= 0) {
          state.history = state.history.slice(0, idx);
        } else {
          state.history = [];
        }
        loadFeed(url, true);
      });
    });
  }

  function renderFeed(feed) {
    const content = $('#content');
    const search = feed.searchTemplate;
    state.searchTemplate = search;
    setSearchVisible(!!search);

    let html = '';

    html += `<div class="feed-header"><h2>${escapeHtml(feed.title)}</h2>`;
    if (feed.subtitle) html += `<p>${escapeHtml(feed.subtitle)}</p>`;
    if (state.itemsPerPage > 0 && state.totalResults > 0) {
      const start = state.currentPage * state.itemsPerPage + 1;
      const end = Math.min(start + state.itemsPerPage - 1, state.totalResults);
      html += `<p>Showing ${start}&ndash;${end} of ${state.totalResults}</p>`;
    }
    html += `</div>`;

    if (feed.navigation.length > 0) {
      html += `<div class="feed-grid">`;
      feed.navigation.forEach(nav => {
        html += `
          <div class="nav-card" data-url="${escapeHtml(nav.href)}">
            <div class="nav-icon">&#128193;</div>
            <h3>${escapeHtml(nav.title)}</h3>
            ${nav.summary ? `<p>${escapeHtml(nav.summary)}</p>` : ''}
          </div>`;
      });
      html += `</div>`;
    }

    if (feed.entries.length > 0) {
      html += `<div class="feed-grid">`;
      feed.entries.forEach((entry, i) => {
        html += renderEntryCard(entry, i);
      });
      html += `</div>`;
    }

    if (feed.navigation.length === 0 && feed.entries.length === 0) {
      html += `<p class="empty-state">This catalog section is empty.</p>`;
    }

    const hasOpenSearchPages = state.totalResults > state.itemsPerPage && state.itemsPerPage > 0;
    const hasRelLinks = feed.paginationLinks && (feed.paginationLinks.next || feed.paginationLinks.prev);
    if (hasOpenSearchPages) {
      html += renderPagination();
    } else if (hasRelLinks) {
      html += renderRelPagination(feed.paginationLinks);
    }

    content.innerHTML = html;

    $$('.nav-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.url;
        if (url) {
          const title = card.querySelector('h3')?.textContent || 'Section';
          state.history.push({ title, url });
          loadFeed(url);
        }
      });
    });

    $$('.entry-card .entry-title-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const idx = parseInt(link.dataset.idx, 10);
        const entry = feed.entries[idx];
        if (entry) showDetail(entry);
      });
    });

    $$('.pagination-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10);
        if (page >= 0) loadPage(page);
      });
    });

    const nextBtn = $('#next-page-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const url = nextBtn.dataset.url;
        if (url) loadFeed(url);
      });
    }
    const prevBtn = $('#prev-page-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const url = prevBtn.dataset.url;
        if (url) loadFeed(url);
      });
    }
  }

  function renderEntryCard(entry, idx) {
    const formatType = (type) => {
      const map = {
        'application/epub+zip': 'EPUB',
        'application/pdf': 'PDF',
        'application/x-mobipocket-ebook': 'MOBI',
        'application/x-kindle': 'AZW3',
        'application/x-cbr': 'CBZ/CBR',
        'text/html': 'HTML',
        'text/plain': 'TXT',
      };
      return map[type] || type.split('/').pop() || 'Download';
    };

    const coverImg = entry.cover
      ? `<img src="${escapeHtml(entry.cover)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<span class=\\'no-cover\\'>&#128212;</span>'">`
      : `<span class="no-cover">&#128212;</span>`;

    const authors = entry.authors.length > 0
      ? escapeHtml(entry.authors.join(', '))
      : '';

    const formats = entry.downloads.slice(0, 2).map(d => {
      return `<a href="${escapeHtml(proxyWrap(d.href))}" class="download" target="_blank" download>${formatType(d.type)}</a>`;
    }).join('') || '';

    const detailAction = `<a href="#" class="entry-title-link" data-idx="${idx}">Details</a>`;

    return `
      <div class="entry-card">
        <div class="entry-cover">${coverImg}</div>
        <div class="entry-body">
          <h3><a href="#" class="entry-title-link" data-idx="${idx}">${escapeHtml(entry.title)}</a></h3>
          ${authors ? `<div class="entry-authors">${authors}</div>` : ''}
          ${entry.summary ? `<div class="entry-summary">${escapeHtml(entry.summary)}</div>` : ''}
          <div class="entry-meta">
            ${entry.language ? `<span class="tag">${escapeHtml(entry.language)}</span>` : ''}
            ${entry.categories.slice(0, 3).map(c => `<span class="tag">${escapeHtml(c)}</span>`).join('')}
            ${entry.published ? `<span class="tag">${escapeHtml(entry.published.slice(0, 4))}</span>` : ''}
          </div>
        </div>
        <div class="entry-actions">
          ${detailAction}
          ${formats}
        </div>
      </div>`;
  }

  function renderRelPagination(links) {
    return `<div class="pagination">
      <button id="prev-page-btn" class="secondary" data-url="${escapeHtml(links.prev || '')}" ${links.prev ? '' : 'disabled'}>&#8249; Previous</button>
      <button id="next-page-btn" class="secondary" data-url="${escapeHtml(links.next || '')}" ${links.next ? '' : 'disabled'}>Next &#8250;</button>
    </div>`;
  }

  function renderPagination() {
    const totalPages = Math.ceil(state.totalResults / state.itemsPerPage);
    const currentPage = state.currentPage;
    let html = `<div class="pagination">`;
    html += `<button class="pagination-btn secondary page-first" data-page="0" ${currentPage === 0 ? 'disabled' : ''}>&#171; First</button>`;
    html += `<button class="pagination-btn secondary" data-page="${currentPage - 1}" ${currentPage === 0 ? 'disabled' : ''}>&#8249; Prev</button>`;
    html += `<span>Page ${currentPage + 1} of ${totalPages}</span>`;
    html += `<button class="pagination-btn secondary" data-page="${currentPage + 1}" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8250;</button>`;
    html += `<button class="pagination-btn secondary page-last" data-page="${totalPages - 1}" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Last &#187;</button>`;
    html += `</div>`;
    return html;
  }

  function showDetail(entry) {
    const content = $('#content');

    const formatLabel = (type) => {
      const map = {
        'application/epub+zip': 'EPUB',
        'application/pdf': 'PDF',
        'application/x-mobipocket-ebook': 'MOBI',
        'application/x-kindle': 'AZW3',
        'application/x-cbr': 'CBZ/CBR',
        'text/html': 'HTML',
        'text/plain': 'TXT',
      };
      return map[type] || type;
    };

    const coverImg = entry.cover
      ? `<img src="${escapeHtml(entry.cover)}" alt="${escapeHtml(entry.title)}" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'no-cover\\'>&#128212;</div>'">`
      : `<div class="no-cover">&#128212;</div>`;

    const authors = entry.authors.length > 0
      ? `<p class="authors">by ${escapeHtml(entry.authors.join(', '))}</p>`
      : '';

    const summary = entry.summary
      ? `<div class="summary">${escapeHtml(entry.summary)}</div>`
      : '';

    const meta = [];
    if (entry.published) meta.push(['Published', entry.published.slice(0, 10)]);
    if (entry.updated) meta.push(['Updated', entry.updated.slice(0, 10)]);
    if (entry.language) meta.push(['Language', entry.language]);
    if (entry.id) meta.push(['ID', entry.id.slice(0, 60)]);
    if (entry.categories.length > 0) meta.push(['Categories', entry.categories.join(', ')]);

    const metaHtml = meta.length > 0
      ? `<div class="detail-meta">${meta.map(([l, v]) => `<span class="label">${l}</span><span class="value">${escapeHtml(v)}</span>`).join('')}</div>`
      : '';

    const downloads = entry.downloads.length > 0
      ? `<div class="detail-links">${entry.downloads.map(d => `<a href="${escapeHtml(proxyWrap(d.href))}" target="_blank" download>${escapeHtml(formatLabel(d.type))}</a>`).join('')}</div>`
      : '';

    const alternate = entry.links.alternate
      ? `<div class="detail-alternate"><a href="${escapeHtml(entry.links.alternate)}" target="_blank" class="secondary">View on publisher site &#8599;</a></div>`
      : '';

    state.history.push({ title: entry.title, url: state.currentUrl });

    if (entry.id) {
      updateUrlParams({ book: entry.id }, true);
    }

    content.innerHTML = `
      <div id="detail-view">
        <div class="detail-back">
          <a href="#" id="detail-back-link">&#8592; Back to catalog</a>
        </div>
        <div class="detail-content">
          <div class="detail-cover">${coverImg}</div>
          <div class="detail-info">
            <h2>${escapeHtml(entry.title)}</h2>
            ${authors}
            ${summary}
            ${metaHtml}
            ${downloads}
            ${alternate}
          </div>
        </div>
      </div>`;

    $('#detail-back-link').addEventListener('click', e => {
      e.preventDefault();
      state.history.pop();
      updateUrlParams({ book: '' }, true);
      reloadCurrentFeed();
    });
  }

  async function loadPage(page) {
    const url = new URL(state.selfUrl || state.currentUrl);
    if (state.itemsPerPage > 0) {
      url.searchParams.set('startIndex', (page * state.itemsPerPage).toString());
    }
    await loadFeed(url.href);
  }

  function upgradeTemplateUrl(url, baseUrl) {
    const baseIsHttps = baseUrl && baseUrl.startsWith('https://');
    if (baseIsHttps && url && url.startsWith('http://')) {
      return 'https://' + url.slice(7);
    }
    return url;
  }

  async function resolveSearchTemplate(templateUrl) {
    if (!templateUrl) return null;
    if (templateUrl.includes('{searchTerms}')) return upgradeTemplateUrl(templateUrl, state.currentUrl);

    try {
      const doc = await fetchXml(templateUrl);
      const root = doc.documentElement;
      const urls = root.getElementsByTagNameNS(NS.opensearch, 'Url');
      for (const url of Array.from(urls)) {
        const type = url.getAttribute('type') || '';
        if (type.includes('atom') || type.includes('xml')) {
          const t = url.getAttribute('template');
          if (t) return upgradeTemplateUrl(buildUrl(templateUrl, t), state.currentUrl);
        }
      }
      for (const url of Array.from(urls)) {
        const t = url.getAttribute('template');
        if (t) return upgradeTemplateUrl(buildUrl(templateUrl, t), state.currentUrl);
      }
    } catch {}

    return upgradeTemplateUrl(templateUrl, state.currentUrl);
  }

  async function loadFeed(url, replaceHistory = false) {
    showLoading(true);
    showError('');
    state.currentUrl = url;
    state.navigation = [];
    state.entries = [];
    state.totalResults = 0;
    state.itemsPerPage = 0;
    state.currentPage = 0;

    try {
      const doc = await fetchXml(url);
      const feed = parseFeed(doc);
      feed.searchTemplate = await resolveSearchTemplate(feed.searchTemplate);
      state.searchTemplate = feed.searchTemplate;
      state.navigation = feed.navigation;
      state.entries = feed.entries;
      renderBreadcrumb();
      renderFeed(feed);
      const params = { url, search: '' };
      if (state.rootUrl) params.feed = state.rootUrl;
      updateUrlParams(params, replaceHistory);
    } catch (err) {
      if (err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
        showError('Cannot reach the server. Try enabling the CORS proxy above, or check that the URL is correct.');
      } else {
        showError(`Error loading catalog: ${err.message}`);
      }
    } finally {
      showLoading(false);
    }
  }

  function reloadCurrentFeed() {
    if (state.currentUrl) {
      loadFeed(state.currentUrl, true);
    }
  }

  async function searchCatalog(query) {
    if (!state.searchTemplate) return;
    const url = state.searchTemplate.replace('{searchTerms}', encodeURIComponent(query));
    state.history.push({ title: `Search: ${query}`, url });
    await loadFeed(url);
    updateUrlParams({ search: query }, true);
  }

  function getUrlParams() {
    return Object.fromEntries(new URL(window.location).searchParams.entries());
  }

  function updateUrlParams(params, replace = false) {
    const url = new URL(window.location);
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }
    const stateData = { history: [...state.history], currentUrl: state.currentUrl };
    if (replace) {
      history.replaceState(stateData, '', url);
    } else {
      history.pushState(stateData, '', url);
    }
  }

  let landingHtml = '';

  function init() {
    const params = getUrlParams();
    landingHtml = $('#content').innerHTML;
    if (params.feed) {
      $('#feed-url').value = params.feed;
    }
    if (params.proxy) {
      const opt = $('#proxy-select').querySelector(`[value="${params.proxy}"]`);
      if (opt) $('#proxy-select').value = params.proxy;
    }
    $('#proxy-select').addEventListener('change', () => {
      updateUrlParams({ proxy: $('#proxy-select').value }, true);
    });

    $('#load-btn').addEventListener('click', () => {
      const url = getFeedUrl();
      if (!url) return;
      state.rootUrl = url;
      state.currentUrl = url;
      state.history = [];
      loadFeed(url);
    });

    $('#feed-url').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('#load-btn').click();
    });

    $('#search-btn').addEventListener('click', () => {
      const q = $('#search-input').value.trim();
      if (q) searchCatalog(q);
    });

    $('#search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('#search-btn').click();
    });

    $('#content').addEventListener('click', e => {
      const example = e.target.closest('.examples a');
      if (example) {
        e.preventDefault();
        const url = example.dataset.url;
        if (url) {
          $('#feed-url').value = url;
          state.rootUrl = url;
          state.currentUrl = url;
          state.history = [];
          loadFeed(url);
        }
      }
    });

    window.addEventListener('popstate', (e) => {
      const params = getUrlParams();
      if (params.url) {
        if (e.state) {
          state.history = e.state.history || [];
          state.currentUrl = e.state.currentUrl || '';
        }
        loadFeed(params.url, true).then(() => {
          if (params.book && state.entries.length > 0) {
            const entry = state.entries.find(e => e.id === params.book);
            if (entry) showDetail(entry);
          }
        });
      } else {
        state.history = [];
        state.currentUrl = '';
        state.navigation = [];
        state.entries = [];
        state.searchTemplate = null;
        state.currentPage = 0;
        state.totalResults = 0;
        state.itemsPerPage = 0;
        state.selfUrl = '';
        showLoading(false);
        showError('');
        $('#breadcrumb').style.display = 'none';
        $('#search-bar').classList.add('hidden');
        $('#content').innerHTML = landingHtml;
      }
    });

    if (params.url) {
      state.rootUrl = params.feed || params.url;
      loadFeed(params.url, true).then(() => {
        if (params.book && state.entries.length > 0) {
          const entry = state.entries.find(e => e.id === params.book);
          if (entry) showDetail(entry);
        }
      });
    } else if (params.search && params.feed) {
      state.rootUrl = params.feed;
      state.currentUrl = params.feed;
      loadFeed(params.feed, true).then(() => {
        if (state.searchTemplate) {
          searchCatalog(params.search);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { loadFeed, searchCatalog };
})();
