namespace HumanSurface.Tests;

/// <summary>
/// A test list, an assertion helper, and the two things a runner owes: a count and an exit code.
/// </summary>
/// <remarks>
/// Small on purpose. Everything in this suite is either a pure function, a state machine driven one
/// step at a time, or a process talking to a real pipe; none of it needs fixtures, and a case that
/// cannot run here says so out loud rather than passing quietly.
/// </remarks>
internal sealed class TestRun
{
    private readonly List<(string Name, Func<Task> Body)> _tests = [];
    private readonly List<string> _skipped = [];
    private int _passed;
    private int _failed;

    public void Add(string name, Action body) => _tests.Add((name, () =>
    {
        body();
        return Task.CompletedTask;
    }));

    public void Add(string name, Func<Task> body) => _tests.Add((name, body));

    /// <summary>
    /// Records a case that could not run, with the reason. Never a silent pass — a suite that skipped
    /// its Windows cases on the Linux runner and said nothing would read as coverage it does not have.
    /// </summary>
    public void Skip(string name, string reason) => _skipped.Add($"{name} — {reason}");

    public async Task<int> ExecuteAsync()
    {
        foreach (var (name, body) in _tests)
        {
            try
            {
                await body().ConfigureAwait(false);
                _passed++;
                Console.WriteLine($"  PASS  {name}");
            }
            catch (Exception exception)
            {
                _failed++;
                Console.WriteLine($"  FAIL  {name}");
                Console.WriteLine($"        {Indent(exception.Message)}");
            }
        }

        foreach (var skip in _skipped)
        {
            Console.WriteLine($"  SKIP  {skip}");
        }

        Console.WriteLine();
        Console.WriteLine($"  {_passed} passed, {_failed} failed, {_skipped.Count} skipped");
        return _failed == 0 ? 0 : 1;
    }

    private static string Indent(string message) =>
        message.Replace("\r\n", "\n").Replace("\n", "\n        ");
}

internal sealed class AssertionException(string message) : Exception(message);

internal static class Assert
{
    public static void True(bool condition, string what)
    {
        if (!condition) throw new AssertionException($"{what}: expected true, was false");
    }

    public static void False(bool condition, string what)
    {
        if (condition) throw new AssertionException($"{what}: expected false, was true");
    }

    public static void Equal<T>(T expected, T actual, string what)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new AssertionException($"{what}: expected {Show(expected)}, was {Show(actual)}");
        }
    }

    public static void NotEqual<T>(T expected, T actual, string what)
    {
        if (EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new AssertionException($"{what}: expected anything but {Show(actual)}");
        }
    }

    public static void NotNull(object? value, string what)
    {
        if (value is null) throw new AssertionException($"{what}: expected a value, was null");
    }

    public static void Null(object? value, string what)
    {
        if (value is not null) throw new AssertionException($"{what}: expected null, was {Show(value)}");
    }

    public static void SequenceEqual<T>(IReadOnlyList<T> expected, IReadOnlyList<T> actual, string what)
    {
        if (expected.Count != actual.Count)
        {
            throw new AssertionException(
                $"{what}: expected {expected.Count} entries, was {actual.Count}\n" +
                $"expected {Show(expected)}\nactual   {Show(actual)}");
        }

        for (var index = 0; index < expected.Count; index++)
        {
            if (!EqualityComparer<T>.Default.Equals(expected[index], actual[index]))
            {
                throw new AssertionException(
                    $"{what}: entry {index} differs — expected {Show(expected[index])}, " +
                    $"was {Show(actual[index])}");
            }
        }
    }

    // Quoted and escaped, so that a failure about whitespace or a control character shows the
    // difference instead of rendering two identical-looking lines.
    private static string Show<T>(T value) => value switch
    {
        null => "null",
        string text => System.Text.Json.JsonSerializer.Serialize(text),
        System.Collections.IEnumerable sequence and not string =>
            "[" + string.Join(", ", sequence.Cast<object?>().Select(Show)) + "]",
        _ => value.ToString() ?? "null",
    };
}
