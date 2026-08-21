#!/usr/bin/env bash
# add-photo.sh — outil auteur : synchronise les dossiers de photos avec
# data/photos.toml. Déposer une image dans images/<slug>/ suffit à la classer.
#
#   0. inventaire des dossiers de séries
#   1. conversion des sources non-webp (la source est SUPPRIMÉE)
#   2. contrôle de l'appariement images/<slug>/ ↔ content/<slug>.md
#   3. miniatures — délégué à bin/build-thumbs.sh
#   4. régénération de data/photos.toml
#
# Deux appelants : l'auteur en local, et l'étape « Sync content » du
# déploiement. Ne pas dupliquer cette logique dans le workflow.
#
# Idempotent. Dépend du paquet `webp` ; `heif-convert` (libheif-examples) n'est
# réclamé qu'au moment de rencontrer un HEIC.
#
# Usage : bin/add-photo.sh   (aucun argument)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHOTOS_DIR="$ROOT/static/assets/images"
CONTENT_DIR="$ROOT/content"
DATA_FILE="$ROOT/data/photos.toml"

command -v cwebp    >/dev/null || { echo "cwebp introuvable (ex. : apt install webp)"; exit 1; }
mkdir -p "$PHOTOS_DIR" "$(dirname "$DATA_FILE")"

# ─── 0. Inventaire des séries présentes ──────────────────────────────────────
#        Un dossier de premier niveau = une série, À CONDITION qu'il contienne
#        au moins une image. Le sous-dossier thumbs/ est hors d'atteinte : il
#        est d'un niveau plus bas.
#
#        Un dossier réduit à ses seules miniatures est un résidu, pas une série.
#        Le cache du déploiement restaure `*/thumbs` par repli de préfixe, ce qui
#        ressuscite le dossier d'une série supprimée depuis : sans ce filtre,
#        elle serait signalée comme « série sans contenu » à chaque déploiement,
#        et le déploiement échouerait indéfiniment. Le résidu n'est pas effacé
#        ici — l'étape 3 s'en charge, `build-thumbs.sh` supprimant déjà les
#        miniatures d'un dossier sans photo.
#
#        On accepte aussi les sources non encore converties : à ce stade, un
#        dossier fraîchement rempli de JPEG ne contient encore aucun .webp.
shopt -s nullglob nocaseglob
slugs=()
for dir in "$PHOTOS_DIR"/*/; do
  [ -d "$dir" ] || continue
  images=("$dir"*.{webp,jpg,jpeg,png,tif,tiff,heic,heif})
  [ "${#images[@]}" -gt 0 ] || continue
  slugs+=("$(basename "$dir")")
done
shopt -u nullglob nocaseglob
[ "${#slugs[@]}" -gt 0 ] || { echo "aucune série dans $PHOTOS_DIR"; exit 1; }

# Le script s'arrête dessus à la fin de l'étape 1. Sans ce compteur, une photo
# illisible sort en 0 et manque au site sans que rien ne le signale — invisible
# au déploiement, sous une coche verte.
failed=0

# Convertit <src> en WebP <out> (EXIF retiré, résolution d'origine conservée)
# puis supprime la source. En cas d'échec, la source est conservée.
convert_source() {  # <src> <out> <étiquette>
  local src=$1 out=$2 label=$3 tmp=""

  # cwebp ne lit pas le HEIC : on le décode en PNG (sans perte) d'abord, pour
  # que l'encodage WebP final reste le même quel que soit le format d'entrée.
  case "${src,,}" in
    *.heic | *.heif)
      if ! command -v heif-convert >/dev/null; then
        echo "ÉCHEC    : ${src##*/} — heif-convert introuvable (apt install libheif-examples)"
        failed=$((failed + 1)); return
      fi
      # Hors du dossier des photos : un intermédiaire qu'une interruption y
      # laisserait serait pris pour une source au passage suivant.
      tmp="$(mktemp --suffix=.png)"
      if ! heif-convert "$src" "$tmp" >/dev/null 2>&1 || [ ! -s "$tmp" ]; then
        rm -f "$tmp"
        echo "ÉCHEC    : ${src##*/} — décodage HEIC impossible"
        failed=$((failed + 1)); return
      fi
      ;;
  esac

  if cwebp -q 82 -m 6 -metadata none "${tmp:-$src}" -o "$out" >/dev/null 2>&1 && [ -s "$out" ]; then
    rm -f "$src" ${tmp:+"$tmp"}
    echo "converti : $label — source supprimée"
  else
    rm -f ${tmp:+"$tmp"}
    echo "ÉCHEC    : ${src##*/} — source conservée"
    failed=$((failed + 1))
  fi
}

# ─── 1. Sources non-webp : convertir (EXIF retiré) puis supprimer ─────────────
#        DOIT précéder l'étape 2, qui exige des .webp que cette étape produit.
#        Dans l'ordre inverse, le flux normal (créer le .md, déposer des JPG,
#        lancer le script) échoue sur une couverture « introuvable » que la
#        conversion allait créer juste après.
shopt -s nullglob nocaseglob
for slug in "${slugs[@]}"; do
  dir="$PHOTOS_DIR/$slug/"
  for src in "$dir"*.{jpg,jpeg,png,tif,tiff,heic,heif}; do
    name="${src##*/}"; name="${name%.*}"
    convert_source "$src" "$dir$name.webp" "$slug/$name.webp"
  done
done
shopt -u nullglob nocaseglob

if [ "$failed" -gt 0 ]; then
  echo "$failed conversion(s) en échec — rien n'a été synchronisé au-delà."
  exit 1
fi

# ─── 2. Appariement contenu ↔ photos, vérifié DANS LES DEUX SENS. Chaque série
#        a son content/<slug>.md et l'image que celui-ci désigne : `hero`, sa
#        couverture pleine fenêtre (cadrage paysage attendu). ─────────────────
missing=()

# Vérifie qu'un champ de front matter désigne bien un WebP présent dans le
# dossier de la série. Alimente `missing`.
check_photo_field() {  # <fichier md> <champ> <slug>
  local md=$1 field=$2 slug=$3 val
  val="$(sed -n "s/^$field *= *\"\(.*\)\"\$/\1/p" "$md" | head -1)"
  if [ -z "$val" ]; then
    missing+=("$slug (attendu : $field = \"…\" sous [extra] dans content/$slug.md)")
  elif [ ! -f "$PHOTOS_DIR/$slug/$val.webp" ]; then
    missing+=("$slug ($field introuvable : images/$slug/$val.webp)")
  fi
}

# Sens 1 : un dossier de photos sans fichier de contenu apparié.
for slug in "${slugs[@]}"; do
  md="$CONTENT_DIR/$slug.md"
  if [ ! -f "$md" ]; then
    missing+=("$slug (attendu : content/$slug.md)")
    continue
  fi
  check_photo_field "$md" hero "$slug"
done

# Sens 2 : un fichier de contenu sans dossier de photos. C'est ce sens qui
# attrape un renommage fait à moitié.
shopt -s nullglob
for md in "$CONTENT_DIR"/*.md; do
  slug="${md##*/}"; slug="${slug%.md}"
  # _index.md est la section racine (l'accueil), pas une série.
  if [ "$slug" = "_index" ]; then continue; fi
  if [ ! -d "$PHOTOS_DIR/$slug" ]; then
    missing+=("$slug (dossier de photos absent : images/$slug/)")
  fi
done
shopt -u nullglob

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Contenu mal apparié :"
  for m in "${missing[@]}"; do echo "  - $m"; done
  echo "Créer/corriger le(s) fichier(s) de contenu avant de synchroniser les photos."
  exit 1
fi

# ─── 3. Miniatures — délégué à bin/build-thumbs.sh, que le déploiement lance
#        aussi de son côté (les miniatures sont dérivées et non versionnées).
#        Une seule implémentation, deux appelants. ──────────────────────────────
"$ROOT/bin/build-thumbs.sh"

# ─── 4. Régénérer data/photos.toml depuis les WebP présents ──────────────────
#        Un bloc [[series]] par dossier. Fichier entièrement réécrit : il n'est
#        jamais édité à la main.
IFS=$'\n' slugs=($(sort <<<"${slugs[*]}")); unset IFS

# Noms (sans extension) des photos du dossier <slug>, triés, un par ligne.
# Le sous-dossier thumbs/ est hors d'atteinte : un glob ne descend pas.
photos_of() {  # <slug>
  shopt -s nullglob
  local f
  for f in "$PHOTOS_DIR/$1"/*.webp; do f="${f##*/}"; echo "${f%.webp}"; done | sort
  shopt -u nullglob
}

tmp="$(mktemp)"
{
  echo "# Régénéré par bin/add-photo.sh — ne pas éditer à la main."
  echo

  for slug in "${slugs[@]}"; do
    mapfile -t names < <(photos_of "$slug")

    echo "[[series]]"
    echo "slug = \"$slug\""
    # Nom de fichier le plus récent du dossier (les noms sont datés) : seule
    # source d'ordre chronologique du modèle, qui ne porte aucune date.
    # L'accueil s'en sert pour classer les séries de la plus récente à la plus ancienne.
    echo "latest = \"${names[-1]}\""
    echo "photos = ["
    n=${#names[@]}; i=0
    for name in "${names[@]}"; do
      i=$((i + 1))
      [ "$i" -lt "$n" ] && echo "  \"$name\"," || echo "  \"$name\""
    done
    echo "]"
    echo
  done
} > "$tmp"

if [ -f "$DATA_FILE" ] && diff -q "$tmp" "$DATA_FILE" >/dev/null 2>&1; then
  rm -f "$tmp"
  echo "data/photos.toml déjà à jour."
else
  mv "$tmp" "$DATA_FILE"
  echo "data/photos.toml mis à jour."
  # `zola serve` ne reprend PAS data/ à chaud : il sert indéfiniment la version
  # lue à son démarrage. Symptôme déroutant — la page existe et son titre est à
  # jour (ils viennent du .md, surveillé), mais la série s'affiche sans photos.
  echo "Si \`zola serve\` tourne, redémarre-le : il sert encore l'ancienne version."
fi
