"""Evaluate the local model on synthetic data only; never mutate the ledger."""

import json

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

from ledger.categorization_evaluation import evaluate_synthetic_holdout, load_synthetic_dataset


class Command(BaseCommand):
    help = "Evalúa Ollama con un holdout sintético temporal; no lee movimientos ni cambia la autoaplicación."

    def handle(self, *args, **options):
        dataset = load_synthetic_dataset()

        def predict(prompt):
            response = requests.post(
                f"{settings.LOCAL_LLM_URL}/api/generate",
                json={
                    "model": settings.LOCAL_LLM_MODEL,
                    "prompt": prompt,
                    "format": {
                        "type": "object",
                        "properties": {
                            "category_id": {"type": "integer"},
                            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                            "reason": {"type": "string"},
                        },
                        "required": ["category_id", "confidence", "reason"],
                    },
                    "stream": False,
                    "think": False,
                    "options": {"temperature": 0},
                    "keep_alive": "5m",
                },
                timeout=30,
            )
            response.raise_for_status()
            return response.json()

        report = evaluate_synthetic_holdout(dataset, predict, model_tag=settings.LOCAL_LLM_MODEL)
        self.stdout.write(json.dumps(report, ensure_ascii=False, sort_keys=True))
