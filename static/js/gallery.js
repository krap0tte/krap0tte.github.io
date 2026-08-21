/* Galerie photo — vanilla, sans dépendance ni étape de build.
   Script classique et non module ES : la page reste ouvrable en file://.

   Le détail des arbitrages (pourquoi la grille est rendue au build, pourquoi la
   lightbox substitue ses images au lieu de les muter, etc.) est consigné dans la
   documentation du projet. Ici on ne garde que ce qu'il faut savoir pour ne pas
   casser une ligne. */
(function () {
  'use strict';

  // ─── Données de la page ─────────────────────────────────────────────────────
  function readJSON(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  // Embarqué par partials/serie.html : toutes les séries sont dans la page, ce
  // qui permet de basculer de l'une à l'autre sans requête.
  var DATA = readJSON('site-data') || {};
  var SITE = DATA.site || '';
  var SERIES = DATA.series || [];

  function indexOfSlug(slug) {
    for (var i = 0; i < SERIES.length; i++) {
      if (SERIES[i].slug === slug) return i;
    }
    return -1;
  }

  var currentSerie = Math.max(0, indexOfSlug(DATA.current));

  // Les photos ne sont pas dans le JSON : chaque carte de la grille est déjà un
  // vrai lien vers sa pleine résolution. Les lire dans le DOM évite d'en tenir
  // une seconde description, et fait suivre la lightbox sans rien synchroniser.
  var PHOTOS = [];

  function gridContainer() {
    return document.querySelector('.gallery-grid__container');
  }

  function readPhotos() {
    var c = gridContainer();
    PHOTOS = c ? Array.prototype.map.call(
      c.querySelectorAll('.gallery-card'), function (a) { return a.href; }
    ) : [];
  }

  // Remplit un conteneur depuis un <template>. `cloneNode` plutôt qu'`innerHTML` :
  // le fragment est déjà analysé, rien n'est relu.
  function fillFrom(target, tpl) {
    target.textContent = '';
    if (tpl) target.appendChild(tpl.content.cloneNode(true));
  }

  function templateFor(kind, slug) {
    return document.querySelector('[data-serie-' + kind + '="' + slug + '"]');
  }

  // Ctrl/Cmd/Maj et le clic milieu ouvrent dans un nouvel onglet : ne jamais
  // les intercepter.
  function isPlainClick(e) {
    return !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0;
  }

  // Chemin d'une URL, sans barre finale. On compare des `pathname` entiers et
  // non des fins de chaîne : « her-friends » se confondrait avec
  // « lotus-and-her-friends ».
  function pathOf(url) {
    var a = document.createElement('a');
    a.href = url;
    return a.pathname.replace(/\/+$/, '');
  }

  function indexOfPath(pathname) {
    var path = pathname.replace(/\/+$/, '');
    for (var i = 0; i < SERIES.length; i++) {
      if (pathOf(SERIES[i].url) === path) return i;
    }
    return -1;
  }

  // Renvoie au premier élément depuis le dernier, et inversement. Le tableau
  // reçu doit suivre l'ordre du DOM, sinon la boucle se referme trop tôt et
  // rend le dernier bouton inatteignable au clavier.
  function trapTabFocus(focusable, e) {
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var atEdge = e.shiftKey
      ? document.activeElement === first
      : document.activeElement === last;
    if (atEdge) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  // ─── Lightbox ───────────────────────────────────────────────────────────────
  var lightbox = (function () {
    var root, stage, img, loader, prevBtn, nextBtn, gridBtn;
    var current = 0;
    var lastFocused = null;
    var navTimeout = null;   // navigation clic/clavier
    var swipeTimeout = null; // navigation au glissement
    var loadToken = 0;

    function isOpen() {
      return root.classList.contains('is-open');
    }

    // Les deux minuteries s'annulent ensemble : un glissement suivi d'un clic
    // ferait sinon cohabiter deux mises à jour de `current`.
    function clearTimeouts() {
      if (navTimeout) { clearTimeout(navTimeout); navTimeout = null; }
      if (swipeTimeout) { clearTimeout(swipeTimeout); swipeTimeout = null; }
    }

    function newImage() {
      var el = new Image();
      el.className = 'lightbox__img is-loading';
      el.alt = '';
      return el;
    }

    function replaceImage(el) {
      img.parentNode.replaceChild(el, img);
      img = el;
    }

    // On ne mute JAMAIS l'image affichée : on la dépose, et on lui substitue un
    // élément neuf une fois celui-ci prêt à peindre. iOS Safari n'honore de
    // façon fiable ni l'opacité ni le changement de `src` sur un élément
    // installé de longue date — un nœud neuf, si.
    function update() {
      var url = PHOTOS[current];
      var token = ++loadToken;

      // L'image sortante part d'un coup. Son fondu de sortie, lui, a déjà eu
      // lieu : `navigate()` lui laisse 200 ms avant d'arriver ici.
      replaceImage(newImage());
      loader.classList.add('is-visible');

      // Chargée hors du document, puis insérée telle quelle : aucun `src` n'est
      // jamais posé sur un élément déjà affiché, et celui qu'on insère porte
      // déjà son bitmap décodé.
      var next = newImage();

      function swap() {
        if (token !== loadToken) return; // une navigation plus récente a pris la main

        // Ne jamais agrandir au-delà de la résolution réelle de la photo.
        var dpr = window.devicePixelRatio || 1;
        if (next.naturalWidth &&
            next.naturalWidth < stage.clientWidth * dpr &&
            next.naturalHeight < stage.clientHeight * dpr) {
          next.style.width = (next.naturalWidth / dpr) + 'px';
          next.style.height = (next.naturalHeight / dpr) + 'px';
        }
        replaceImage(next);

        // Double rAF : sans état de départ peint, la transition ne joue pas.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (token !== loadToken) return;
            img.classList.remove('is-loading');
            loader.classList.remove('is-visible');
          });
        });
      }

      // `decode()` après `load` et non à sa place : certaines versions de Safari
      // rejettent un `decode()` demandé dans la foulée d'un `src`.
      next.onload = function () {
        if (next.decode) next.decode().then(swap, swap);
        else swap();
      };
      next.onerror = swap; // on substitue quand même : l'erreur doit se voir
      next.src = url;

      // Une seule photo : rien où aller, il ne reste que la sortie.
      prevBtn.hidden = nextBtn.hidden = PHOTOS.length < 2;
    }

    function open(index) {
      if (!root) return;
      lastFocused = document.activeElement;
      current = index;
      update();
      root.classList.add('is-open');
      root.removeAttribute('aria-hidden');
      document.body.style.overflow = 'hidden';
      gridBtn.focus();
    }

    function close() {
      clearTimeouts();
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function navigate(dir) {
      var hadPendingSwipe = swipeTimeout !== null;
      clearTimeouts();

      var next = (current + dir + PHOTOS.length) % PHOTOS.length;

      // Un glissement était en cours de sortie : on annule son déplacement d'un
      // coup, sinon l'image entame son fondu déjà décalée hors écran.
      if (hadPendingSwipe) {
        img.style.transition = 'none';
        img.style.transform = '';
        void img.offsetWidth;
        img.style.transition = '';
      }

      img.style.opacity = '0';

      navTimeout = setTimeout(function () {
        navTimeout = null;
        current = next;
        update();
      }, 200);
    }

    function bind() {
      var swipeStartX = 0;
      var swipeDragging = false;

      function snapBack() {
        img.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
        img.style.transform = '';
        img.style.opacity = '';
        setTimeout(function () { img.style.transition = ''; }, 300);
      }

      stage.addEventListener('touchstart', function (e) {
        clearTimeouts();
        swipeStartX = e.touches[0].clientX;
        swipeDragging = false;
        img.style.transition = 'none';
      }, { passive: true });

      stage.addEventListener('touchmove', function (e) {
        var delta = e.touches[0].clientX - swipeStartX;
        if (!swipeDragging && Math.abs(delta) > 6) swipeDragging = true;
        if (swipeDragging && PHOTOS.length > 1) {
          img.style.transform = 'translateX(' + delta + 'px)';
          img.style.opacity = String(Math.max(0, 1 - Math.abs(delta) / (window.innerWidth * 0.6)));
        }
      }, { passive: true });

      stage.addEventListener('touchend', function (e) {
        if (!swipeDragging) { img.style.transition = ''; return; }
        swipeDragging = false;

        var delta = e.changedTouches[0].clientX - swipeStartX;
        if (PHOTOS.length < 2 || Math.abs(delta) <= window.innerWidth * 0.25) {
          snapBack();
          return;
        }

        var dir = delta < 0 ? 1 : -1;
        img.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
        img.style.transform = 'translateX(' + (delta < 0 ? '-110%' : '110%') + ')';
        img.style.opacity = '0';
        swipeTimeout = setTimeout(function () {
          swipeTimeout = null;
          current = (current + dir + PHOTOS.length) % PHOTOS.length;
          update();
        }, 220);
      }, { passive: true });

      stage.addEventListener('touchcancel', function () {
        if (swipeDragging) snapBack();
        swipeDragging = false;
      }, { passive: true });

      // Clic sur le fond de la scène, hors image.
      stage.addEventListener('click', function (e) {
        if (e.target === stage) close();
      });

      document.addEventListener('keydown', function (e) {
        if (!isOpen()) return;
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowLeft') { navigate(-1); return; }
        if (e.key === 'ArrowRight') { navigate(1); return; }
        if (e.key === 'Tab') {
          // Ordre du DOM — voir `trapTabFocus()`. `offsetParent` écarte les
          // flèches masquées quand la série n'a qu'une photo.
          trapTabFocus([prevBtn, gridBtn, nextBtn].filter(function (el) {
            return el.offsetParent !== null;
          }), e);
        }
      });

      prevBtn.addEventListener('click', function () { navigate(-1); });
      nextBtn.addEventListener('click', function () { navigate(1); });
      gridBtn.addEventListener('click', close);
    }

    function init() {
      // Sans cette garde, une page dépourvue de lightbox ferait échouer TOUT le
      // script — grille et header compris — et pas ce seul module.
      root = document.querySelector('.lightbox');
      if (!root) return;
      stage = root.querySelector('.lightbox__stage');
      img = root.querySelector('.lightbox__img');
      loader = root.querySelector('.lightbox__loader');
      prevBtn = root.querySelector('[data-lb="prev"]');
      nextBtn = root.querySelector('[data-lb="next"]');
      gridBtn = root.querySelector('[data-lb="grid"]');
      bind();
    }

    // Pour la bascule de série : la visionneuse resterait sinon ouverte sur les
    // photos de la série qu'on vient de quitter.
    function closeIfOpen() {
      if (root && isOpen()) close();
    }

    return { init: init, open: open, closeIfOpen: closeIfOpen };
  })();

  // ─── Grille ─────────────────────────────────────────────────────────────────
  // Le rendu initial vient du gabarit, pas d'ici. `renderGrid()` ne sert qu'aux
  // bascules de série, et se contente de copier le <template> correspondant :
  // le balisage d'une carte n'est décrit qu'à un seul endroit, la macro Tera.
  function renderGrid(slug) {
    var c = gridContainer();
    if (!c) return;
    fillFrom(c, templateFor('grid', slug));
    readPhotos();
  }

  // Ouverture par délégation : un seul écouteur, valable aussi bien pour les
  // cartes du gabarit que pour celles d'une série chargée ensuite.
  function wireGrid() {
    var c = gridContainer();
    if (!c) return;
    c.addEventListener('click', function (e) {
      if (!isPlainClick(e)) return;
      var card = e.target.closest('.gallery-card');
      if (!card) return;
      e.preventDefault();
      var i = Array.prototype.indexOf.call(c.querySelectorAll('.gallery-card'), card);
      if (i >= 0) lightbox.open(i);
    });
  }

  // ─── Couverture ─────────────────────────────────────────────────────────────
  // Dit QUAND révéler la couverture ; tout l'habillage est en CSS (_hero.scss).
  // `decode()` et non `load` : la couverture est servie en pleine résolution et
  // son décodage dure assez pour qu'un fondu lancé sur `load` démarre sur une
  // image encore impossible à peindre. On révèle même en cas d'échec — une
  // couverture noire définitive serait pire que l'absence de fondu.
  function revealHero(hero) {
    var img = hero && hero.querySelector('.hero__img');
    if (!img) return;

    function show() {
      // Double rAF : sans état de départ peint, la transition ne joue pas.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { hero.classList.add('is-revealed'); });
      });
    }

    if (img.decode) img.decode().then(show, show);
    else if (img.complete) show();
    else {
      img.addEventListener('load', show, { once: true });
      img.addEventListener('error', show, { once: true });
    }
  }

  // ─── Bascule de série ───────────────────────────────────────────────────────
  // Les liens Précédente/Suivante restent de VRAIS liens vers des pages
  // réellement générées : sans JS, ou si quoi que ce soit échoue ici, ils
  // rechargent simplement la page.
  var serieNav = (function () {
    var heroEl, heroImg, heroTitle, titleEl, intro, prevLink, nextLink;

    // Les liens existent toujours : seul `hidden` change. Le rendu serveur pose
    // déjà l'état juste, il n'y a donc jamais de nœud à créer.
    function setLink(el, i) {
      if (!el) return;
      var s = SERIES[i];
      if (!s) { el.hidden = true; return; }
      el.hidden = false;
      el.href = s.url;
    }

    function render(i) {
      var s = SERIES[i];
      if (!s) return;
      currentSerie = i;

      lightbox.closeIfOpen();

      // Retirer `is-revealed` masque la couverture instantanément — la
      // transition n'existe qu'à l'aller (_hero.scss) — puis `revealHero()` la
      // ramène quand la nouvelle photo est décodée.
      heroEl.classList.remove('is-revealed');
      heroImg.src = s.hero;
      revealHero(heroEl);
      heroTitle.textContent = s.title;
      // Doit composer exactement le même titre que les gabarits, sinon un
      // rechargement après bascule le changerait sous les yeux du visiteur.
      titleEl.textContent = s.title + ' — ' + SITE;

      if (intro) {
        var tpl = templateFor('intro', s.slug);
        fillFrom(intro, tpl);
        intro.hidden = !tpl;
      }

      // La liste va de la plus récente à la plus ancienne : « précédente »
      // (plus ancienne) est donc i + 1.
      setLink(prevLink, i + 1);
      setLink(nextLink, i - 1);

      renderGrid(s.slug);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function go(i, url) {
      render(i);
      window.history.pushState({ slug: SERIES[i].slug }, '', url);
    }

    function init() {
      heroEl = document.querySelector('.hero');
      heroImg = document.querySelector('.hero__img');
      heroTitle = document.querySelector('.hero__title');
      intro = document.querySelector('.series-intro');
      prevLink = document.querySelector('[data-serie-nav="older"]');
      nextLink = document.querySelector('[data-serie-nav="newer"]');
      titleEl = document.querySelector('title');
      // Pas une vue de série, ou rien où aller : les liens restent ordinaires.
      if (!heroEl || !heroImg || !heroTitle || SERIES.length < 2) return;

      [[prevLink, 1], [nextLink, -1]].forEach(function (pair) {
        var el = pair[0];
        if (!el) return;
        el.addEventListener('click', function (e) {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          go(currentSerie + pair[1], el.href);
        });
      });

      // `replaceState` d'abord, pour que le premier retour arrière ait un état.
      window.history.replaceState({ slug: SERIES[currentSerie].slug }, '', window.location.href);
      window.addEventListener('popstate', function () {
        var i = indexOfPath(window.location.pathname);
        render(i < 0 ? 0 : i); // aucune série à cette adresse : c'est la racine
      });
    }

    return { init: init };
  })();

  // ─── Invite au défilement ───────────────────────────────────────────────────
  function wireScrollDown() {
    var btn = document.querySelector('[data-scroll-down]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var target = document.querySelector('.series-intro:not([hidden])') ||
                   document.querySelector('.gallery-grid');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ─── Amorçage ───────────────────────────────────────────────────────────────
  // `renderGrid()` n'est PAS appelée ici : la grille est déjà dans le HTML, la
  // rejouer annulerait les téléchargements que le navigateur a déjà lancés.
  function boot() {
    revealHero(document.querySelector('.hero')); // en premier : c'est ce qu'on regarde
    readPhotos();
    lightbox.init();
    wireGrid();
    serieNav.init();
    wireScrollDown();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
