namespace TBReplays.Online;

public sealed record SceneQuaternion(double X, double Y, double Z, double W);
public sealed record SceneCamera(SketchPoint Position, SceneQuaternion Quaternion, SketchPoint Target, double Fov);
public sealed record ScenePresenceCommand(string SlideId, long Sequence, SketchPoint? Cursor = null, SceneCamera? Camera = null);
public sealed record ScenePresenceFrame(string ConnectionId, string UserId, string Login, string Color,
    string SlideId, long Sequence, long UpdatedAtUnixMs, SketchPoint? Cursor, SceneCamera? Camera);
