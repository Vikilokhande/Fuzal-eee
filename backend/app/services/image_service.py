"""ImageService — configurable image source, metadata only."""
from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class ImageMeta:
    id: str
    url: str
    name: str
    slug: str = ""


IMAGES: list[ImageMeta] = [
    ImageMeta("image_001", "/images/image_001.svg", "Cosmic Fox", "cosmic-fox"),
    ImageMeta("image_002", "/images/image_002.svg", "Futuristic City", "futuristic-city"),
    ImageMeta("image_003", "/images/image_003.svg", "Space Explorer", "space-explorer"),
    ImageMeta("image_004", "/images/image_004.svg", "Neon Cyberpunk", "neon-cyberpunk"),
    ImageMeta("image_005", "/images/image_005.svg", "Abstract Geometry", "abstract-geometry"),
]


class ImageService:
    def __init__(self, images: list[ImageMeta] | None = None):
        self._images = images or IMAGES

    def list(self) -> list[ImageMeta]:
        return list(self._images)

    def get(self, image_id: str) -> ImageMeta | None:
        return next((i for i in self._images if i.id == image_id), None)

    def get_random_image(self, exclude_ids: list[str] | None = None) -> ImageMeta:
        pool = [i for i in self._images if i.id not in (exclude_ids or [])]
        choices = pool or self._images
        return random.choice(choices)


image_service = ImageService()
SOURCE_VIEWBOX = 800
