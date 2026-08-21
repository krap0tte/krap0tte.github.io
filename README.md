# Portfolio photographique

Site statique généré par **Zola**. Une seule dépendance de développement : le binaire `zola`. Le site s'ouvre sur la série la plus récente et l'on passe d'une série à l'autre sans rechargement.

> **Ce fichier est le mémo du quotidien** : ajouter, modifier, supprimer du contenu, et dépanner.
> Les partis pris d'architecture et l'historique des décisions font l'objet d'une documentation distincte.

---

## Prise en main

```bash
bin/build-thumbs.sh   # après un clone frais : génère les miniatures (non versionnées)
zola serve            # → http://127.0.0.1:1111
```

Nécessite [`zola`](https://www.getzola.org/) et le paquet `webp` (`cwebp` + `webpinfo`). Pour déposer des **HEIC** (export iPhone), il faut en plus `libheif-examples` — le script ne le réclame que s'il rencontre un fichier de ce format.

**Rien de tout cela n'est nécessaire pour éditer le contenu** : voir « Travailler depuis GitHub » plus bas.

**Deux réflexes :**

1. **Toute manipulation de photos se termine par `bin/add-photo.sh`.** Il convertit, contrôle, régénère les miniatures et réécrit `data/photos.toml`. Il est idempotent : le relancer pour rien ne coûte rien.
2. **`zola serve` ne recharge pas `data/photos.toml` à chaud.** Après `bin/add-photo.sh`, le redémarrer — sinon la série s'affiche sans ses photos.

---

## Où trouver quoi

| Je veux changer… | Fichier |
|---|---|
| Le titre du site, l'URL de déploiement | `config.toml` |
| Le titre, la couverture ou le texte d'une série | `content/<slug>.md` |
| Les photos d'une série | `static/assets/images/<slug>/` |
| Les couleurs, la typographie, la mise en page | `sass/_*.scss` |
| Le balisage d'une carte de la grille | `templates/macros.html` |
| La structure de la page (couverture, intro, grille, lightbox) | `templates/partials/serie.html` |
| Le comportement de la visionneuse ou de la bascule de série | `static/js/gallery.js` |

`data/photos.toml` est **régénéré**, jamais édité à la main.

---

## Travailler depuis GitHub, sans rien installer

Le déploiement rejoue `bin/add-photo.sh` à chaque poussée sur `main`. Déposer des images depuis le navigateur suffit donc : **la CI les convertit en WebP, supprime les sources, régénère `data/photos.toml`, et réécrit tout cela dans le dépôt** avant de publier.

| Geste | Où |
|---|---|
| Déposer des photos | `github.com` → dossier de la série → **Add file → Upload files** (glisser-déposer, plusieurs à la fois) |
| Créer / modifier un `.md` | `github.com` → **Add file → Create new file**, ou l'éditeur web (touche <kbd>.</kbd> sur le dépôt) |
| Supprimer une série | Éditeur web : supprimer `content/<slug>.md` **et** le dossier de photos, en une seule validation |

Formats acceptés : JPEG, PNG, TIFF, **HEIC/HEIF**. Inutile de convertir quoi que ce soit à la main.

**Ce qui se passe ensuite**, sans intervention :

1. Les images non-WebP sont converties, EXIF retiré, résolution d'origine conservée ; les sources sont supprimées.
2. L'appariement `content/<slug>.md` ↔ dossier de photos est vérifié dans les deux sens.
3. `data/photos.toml` est régénéré, les miniatures aussi.
4. Un commit **`github-actions[bot]`** revient dans le dépôt avec le résultat, puis le site est publié.

**Trois choses à savoir :**

- **Créer le `.md` avant de déposer les photos**, ou les deux dans la même validation. Un dossier de photos sans fichier de contenu fait échouer le déploiement — volontairement : mieux vaut une croix rouge qu'un site à moitié juste.
- **Si le déploiement échoue**, l'onglet *Actions* donne la raison en clair (couverture introuvable, contenu mal apparié, conversion en échec). Le site en ligne reste inchangé tant que ce n'est pas corrigé.
- **Après le passage de la CI, rafraîchir la page GitHub** avant de continuer à éditer : le commit du bot a modifié le dépôt, et l'éditeur web travaillerait sinon sur une version périmée.

---

## Tâches courantes

### Ajouter une série

Créer `content/<slug>.md` **avant** de déposer les photos. Le nom du fichier est le nom machine : il doit correspondre au dossier de photos.

```toml
+++
title = "Libellé affiché"

[extra]
hero = "2025-03-01_LE_MANS_LOTUS_08"   # nom de fichier sans extension, dans le dossier de la série
+++

Quelques paragraphes de contexte. Ce corps sert de texte d'introduction.
```

Puis déposer les photos dans `static/assets/images/<slug>/` et lancer `bin/add-photo.sh`.

`hero` est la **couverture pleine fenêtre** : cadrage **paysage** attendu — un portrait s'y réduit à une bande horizontale sur grand écran.

### Ajouter des photos

*(en local — depuis GitHub, voir la section précédente)*

Déposer les fichiers (JPEG, PNG, TIFF, HEIC ou WebP) dans le dossier de la série, puis :

```bash
bin/add-photo.sh
```

Les sources non-WebP sont converties (EXIF retiré, résolution d'origine conservée) et **la source est supprimée** — le dépôt ne garde que le WebP.

### Modifier une série

Tout est dans `content/<slug>.md` : `title`, `[extra] hero`, et le corps Markdown pour le texte d'intro. Aucun script à relancer, `zola serve` reconstruit tout seul.

Pour changer la couverture, il suffit de pointer `hero` vers un autre nom de fichier **du même dossier**.

### Retirer ou remplacer une photo

```bash
rm static/assets/images/<slug>/<nom>.webp
bin/add-photo.sh          # supprime aussi ses miniatures devenues orphelines
```

Pour remplacer, déposer la nouvelle image puis supprimer l'ancienne, et lancer le script une fois.

⚠️ **Si la photo retirée est celle déclarée en `hero`**, le script refuse de continuer :

```
Contenu mal apparié :
  - <slug> (hero introuvable : photos/<slug>/<nom>.webp)
```

Pointer `hero` vers une autre photo du dossier, puis relancer.

### Renommer une série

Déplacer **les deux** :

```bash
git mv content/ancien.md content/nouveau.md
git mv static/assets/images/ancien static/assets/images/nouveau
bin/add-photo.sh
```

Tant que les deux ne concordent pas, le site se construit quand même, mais le script signale l'anomalie — dans un sens comme dans l'autre.

### Supprimer une série

```bash
git rm content/<slug>.md
git rm -r static/assets/images/<slug>
rm -rf static/assets/images/<slug>    # ← indispensable, voir ci-dessous
bin/add-photo.sh
```

⚠️ **`git rm -r` ne suffit pas.** Les miniatures (`thumbs/`) ne sont pas versionnées : `git rm` les ignore, le dossier survit, et le script le prend alors pour une série sans contenu :

```
Contenu mal apparié :
  - <slug> (attendu : content/<slug>.md)
```

D'où le `rm -rf` qui suit. Les photos restent récupérables dans l'historique git.

### Changer l'ordre d'affichage

Tout est trié par **nom de fichier**, décroissant (les plus récentes en premier) — les photos dans une série, et les séries entre elles. Il n'y a aucun champ de date ni de position : pour réordonner, renommer les fichiers.

Nommer les sources en conséquence : un préfixe date (`2025-03-01_…`) ou un compteur zéro-paddé (`photo-07`) trient correctement.

---

## Dépannage

| Symptôme | Cause | Correctif |
|---|---|---|
| Grille d'images cassées après un clone | Miniatures non versionnées | `bin/build-thumbs.sh` |
| La série s'affiche **sans photos**, les chevrons du header restent masqués | `zola serve` sert le `data/photos.toml` lu à son démarrage | Redémarrer `zola serve` |
| `bin/add-photo.sh` : « attendu : `content/<slug>.md` » | Dossier de photos sans fichier de contenu | Créer le `.md`, ou supprimer le dossier |
| `bin/add-photo.sh` : « dossier de photos absent » | Fichier de contenu sans dossier | Créer le dossier, ou supprimer le `.md` |
| `bin/add-photo.sh` : « hero introuvable » | `hero` pointe une photo absente du dossier | Corriger `[extra] hero` dans le `.md` |
| `bin/add-photo.sh` : « conversion(s) en échec » | Fichier illisible, ou HEIC sans `libheif-examples` | Remplacer le fichier, ou installer le paquet |
| Le déploiement échoue mais le site reste en ligne | Contenu mal apparié : c'est voulu, rien n'est publié à moitié | Lire l'onglet *Actions*, corriger, repousser |
| Déploiement : « attendu : `content/<slug>.md` » pour une série **déjà supprimée** | Le cache de miniatures a restauré son dossier | Corrigé automatiquement ; si cela persiste, purger le cache dans *Actions → Caches* |
| Le site sort **sans aucun style** | `compile_sass` désactivé — `sass/` est alors ignoré en silence | Vérifier `compile_sass = true` dans `config.toml` |
| Le header est vide | Il n'y a qu'une seule série : les deux chevrons sont masqués | Comportement attendu |

---

## Déploiement — GitHub Pages

1. **Settings → Pages → Source → GitHub Actions**.
2. Pousser sur `main`.

Le workflow `.github/workflows/deploy.yml` fait tout : il installe ses outils, **synchronise le contenu** (conversion des images déposées, `data/photos.toml`, miniatures) et pousse le résultat dans le dépôt, puis construit le site **minifié** et publie `public/`. Rien à faire à la main.

La minification n'a lieu qu'au déploiement — en local, `zola serve` continue de servir du HTML et du JavaScript lisibles. Elle allège d'environ **un tiers** ce qui est réellement transféré.

`base_url` dans `config.toml` porte le sous-chemin GitHub Pages (`https://<user>.github.io/portfolio`) — à ajuster si le dépôt est renommé ou déployé ailleurs.
