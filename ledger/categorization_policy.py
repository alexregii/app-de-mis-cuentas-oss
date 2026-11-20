"""Fail-closed promotion policy for automatic categorization."""

from decimal import Decimal

AUTO_APPLY_PROMOTION_STATUS = "NO_PROMOTION"
MIN_VALIDATED_AUTO_APPLY_PRECISION = Decimal("0.99")
MAX_CATEGORIZATION_ROWS_PER_RUN = 20
CATEGORIZATION_RETRY_COOLDOWN_SECONDS = 15 * 60


def auto_apply_effective(auto_apply_requested, confidence_threshold):
    return bool(
        AUTO_APPLY_PROMOTION_STATUS == "PROMOTED"
        and auto_apply_requested
        and Decimal(str(confidence_threshold)) >= MIN_VALIDATED_AUTO_APPLY_PRECISION
    )


def validated_model_category_id(value, allowed_ids):
    if isinstance(value, bool) or not isinstance(value, int) or value not in allowed_ids:
        raise ValueError("La categoría devuelta por el modelo no es válida.")
    return value


def validated_model_confidence(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("La confianza devuelta por el modelo no es numérica.")
    confidence = Decimal(str(value))
    if not confidence.is_finite() or confidence < 0 or confidence > 1:
        raise ValueError("La confianza del modelo debe ser finita y estar entre 0 y 1.")
    return confidence
