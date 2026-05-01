# Mi Band notes

Mi Band support is planned but not part of v0.1.

## Why not start with Mi Band immediately?

Mi Band devices may require authentication before heart rate data can be read. Different models can have different protocols and pairing flows.

Starting with a mock source makes the project useful for GitHub learning and UI development before Bluetooth complexity is added.

## Planned approach

1. Keep the heart rate source interface stable.
2. Implement mock data first.
3. Implement a standard BLE heart rate source.
4. Research Mi Band-specific authentication and data format.
5. Add model-specific notes and warnings.

## Privacy note

Heart rate data is personal biometric data. The project should avoid uploading heart rate data to any server by default.
