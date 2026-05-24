# Multi-Tenancy
from app.models.organization import Organization  # noqa: F401

# Configuration Layer
from app.models.domain import Domain  # noqa: F401
from app.models.material import Material  # noqa: F401
from app.models.asset_type_model import AssetType  # noqa: F401
from app.models.damage_type_model import DamageType  # noqa: F401

# Asset & Inspection Layer
from app.models.asset import Asset  # noqa: F401
from app.models.asset_segment import AssetSegment  # noqa: F401
from app.models.inspection import Inspection  # noqa: F401

# GCS / Mission Layer
from app.models.mission import Mission  # noqa: F401
from app.models.mission_waypoint import MissionWaypoint  # noqa: F401
from app.models.telemetry_point import TelemetryPoint  # noqa: F401
from app.models.flight_log import FlightLog  # noqa: F401
from app.models.thermal_capture import ThermalCapture  # noqa: F401

# Image & Detection Layer
from app.models.image import Image  # noqa: F401
from app.models.detection import Detection  # noqa: F401

# Analytics Core Layer
from app.models.risk_assessment import RiskAssessment  # noqa: F401
from app.models.damage_progression import DamageProgression  # noqa: F401
from app.models.maintenance_recommendation import MaintenanceRecommendation  # noqa: F401

# V1 Analytics Layer
from app.models.v1_analytics_run import V1AnalyticsRun  # noqa: F401
from app.models.v1_analytics_item import V1AnalyticsItem  # noqa: F401
from app.models.v1_analytics_reason import V1AnalyticsReason  # noqa: F401

# User Management Layer
from app.models.user import User  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401

# GCS Phase D Layer
from app.models.drone import Drone  # noqa: F401
from app.models.pilot import Pilot  # noqa: F401
from app.models.alert import Alert  # noqa: F401
from app.models.geofence import Geofence  # noqa: F401
from app.models.mission_record import MissionRecord  # noqa: F401
