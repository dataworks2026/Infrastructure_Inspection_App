"""Ported verbatim from Tahya's Phase-1 service (app/errors.py)."""


class FieldValidationError(Exception):
    """A save was rejected because of one specific field. Routers turn this
    into a 422 with the field named, same shape as a Pydantic validation
    error, so LIB-4 field-level errors look consistent regardless of
    whether Pydantic or the service layer caught the problem.
    """

    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message
        super().__init__(f"{field}: {message}")


class NotFoundError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)
