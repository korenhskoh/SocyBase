from abc import ABC, abstractmethod

# Standard 20-field output format
STANDARD_FIELDNAMES = [
    "ID", "Name", "First Name", "Last Name",
    "Gender", "Birthday", "Phone", "Relationship", "Education", "Work",
    "Position", "Hometown", "Location", "Website", "Languages",
    "UsernameLink", "Username", "About", "Picture URL", "Updated Time",
]


class AbstractProfileMapper(ABC):
    """Maps platform-specific API responses to the standard 18-field format."""

    @abstractmethod
    def map_to_standard(self, api_response: dict) -> dict:
        """Convert API response to standard field format."""
        pass

    def empty_result(self) -> dict:
        """Return a dict with all standard fields set to NA."""
        return {k: "NA" for k in STANDARD_FIELDNAMES}
