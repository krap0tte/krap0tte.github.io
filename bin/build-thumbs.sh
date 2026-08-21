#!/usr/bin/env bash
# build-thumbs.sh — génère les miniatures servies partout où une photo n'occupe
# PAS l'écran entier (la grille). La pleine résolution reste à la lightbox et
# aux couvertures.
#
#   <slug>/thumbs/<nom>.webp      →  1200 px sur le grand côté (densité 1x)
#   <slug>/thumbs/<nom>-2x.webp   →  2400 px                   (densité 2x)
#
# Pur calcul dérivé : ne touche ni aux sources ni à data/photos.toml. C'est ce
# qui le rend lançable au déploiement, où les miniatures ne sont pas versionnées.
# Le sous-dossier `thumbs/` les met hors d'atteinte des globs `*.webp`, qui ne
# descendent pas dans les sous-dossiers.
#
# Idempotent : une miniature à jour n'est pas régénérée, une orpheline est
# supprimée. Usage : bin/build-thumbs.sh   (aucun argument)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHOTOS_DIR="$ROOT/static/assets/images"
THUMB_DIR_NAME=thumbs
THUMB=1200      # densité 1x.
THUMB_2X=2400   # densité 2x.

command -v cwebp    >/dev/null || { echo "cwebp introuvable (ex. : apt install webp)"; exit 1; }
command -v webpinfo >/dev/null || { echo "webpinfo introuvable (ex. : apt install webp)"; exit 1; }
[ -d "$PHOTOS_DIR" ] || { echo "$PHOTOS_DIR introuvable"; exit 1; }

# Dimensions « W H » d'un WebP (retour 1 si illisible).
webp_dims() {
  local w h
  w="$(webpinfo "$1" 2>/dev/null | sed -n 's/.*Width: *\([0-9]*\).*/\1/p'  | head -1)"
  h="$(webpinfo "$1" 2>/dev/null | sed -n 's/.*Height: *\([0-9]*\).*/\1/p' | head -1)"
  [ -n "$w" ] && [ -n "$h" ] || return 1
  echo "$w $h"
}

# « W H » à passer à cwebp -resize si (w,h) dépasse <max> (retour 1 sinon).
# Plus grand côté ramené à <max> (0 = calculé, ratio préservé) ; jamais d'agrandissement.
resize_args() {
  local w=$1 h=$2 max=$3
  { [ "$w" -gt "$max" ] || [ "$h" -gt "$max" ]; } || return 1
  if [ "$w" -ge "$h" ]; then echo "$max 0"; else echo "0 $max"; fi
}

# Dérive une miniature, si absente ou plus ancienne que sa photo. Une photo déjà
# plus petite que <max> donne une miniature de sa taille (jamais d'agrandissement).
make_thumb() {  # <photo.webp> <miniature.webp> <max> <étiquette>
  local src=$1 out=$2 max=$3 label=$4 dims w h ra
  [ -f "$out" ] && [ "$out" -nt "$src" ] && return 0
  dims="$(webp_dims "$src")" || { echo "ÉCHEC    : $label — photo illisible"; return 0; }
  w="${dims% *}"; h="${dims#* }"
  local -a args=(-q 82 -m 6 -metadata none)
  if ra="$(resize_args "$w" "$h" "$max")"; then args+=(-resize $ra); fi
  if cwebp "${args[@]}" "$src" -o "$out" >/dev/null 2>&1 && [ -s "$out" ]; then
    echo "miniature: $label (≤ ${max}px)"
    made=$((made + 1))
  else
    rm -f "$out"
    echo "ÉCHEC    : $label — miniature non générée"
  fi
}

made=0
removed=0

shopt -s nullglob
for dir in "$PHOTOS_DIR"/*/; do
  [ -d "$dir" ] || continue
  rel="${dir#"$PHOTOS_DIR"/}"; rel="${rel%/}"   # « slug »
  thumbs="$dir$THUMB_DIR_NAME"

  photos=("$dir"*.webp)
  if [ "${#photos[@]}" -eq 0 ]; then
    # Dossier vidé de ses photos : ses miniatures n'ont plus lieu d'être.
    [ -d "$thumbs" ] && { rm -rf "$thumbs"; removed=$((removed + 1)); echo "supprimé : $rel/$THUMB_DIR_NAME/ (dossier sans photo)"; }
    continue
  fi

  mkdir -p "$thumbs"
  # Construit EN MÊME TEMPS qu'on génère, et non déduit ensuite : remonter d'un
  # nom de miniature vers sa photo en retirant « -2x » est ambigu dès qu'une
  # photo s'appelle « X-2x.webp », et sa miniature oscillait alors entre
  # génération et suppression à chaque exécution.
  unset -v expected; declare -A expected
  for photo in "${photos[@]}"; do
    name="${photo##*/}"; name="${name%.webp}"
    make_thumb "$photo" "$thumbs/$name.webp"    "$THUMB"    "$rel/$name"
    make_thumb "$photo" "$thumbs/$name-2x.webp" "$THUMB_2X" "$rel/$name-2x"
    expected["$name.webp"]=1
    expected["$name-2x.webp"]=1
  done

  # Miniatures orphelines : leur photo a été supprimée ou renommée.
  for orphan in "$thumbs"/*.webp; do
    name="${orphan##*/}"
    if [ -n "${expected[$name]+set}" ]; then continue; fi
    rm -f "$orphan"
    removed=$((removed + 1))
    echo "supprimé : $rel/$THUMB_DIR_NAME/$name (miniature orpheline)"
  done
done
shopt -u nullglob

if [ "$made" -eq 0 ] && [ "$removed" -eq 0 ]; then
  echo "miniatures déjà à jour."
else
  echo "miniatures : $made générée(s), $removed supprimée(s)."
fi
