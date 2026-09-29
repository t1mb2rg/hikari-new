using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// A language endpoint whose answers each test states outright.
/// </summary>
/// <remarks>
/// The states worth testing — an endpoint that is not there, that answers immediately, that leaves the
/// question outstanding while other things happen, that answers with something that is not this
/// protocol — are all reachable against a real pipe but none of them is cheap to hold still there.
/// <see cref="Holds"/> is the one that could not be written against a real endpoint at all: it is what
/// makes "a proactive delivery still lands while a question is outstanding" a statement about the
/// session rather than a race the test hopes to win.
/// </remarks>
internal sealed class FakeLanguageAsker : ILanguageAsker
{
    private readonly Queue<Func<string, CancellationToken, Task<LanguageAskResult>>> _script = new();
    private TaskCompletionSource _gate = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Every question put to this endpoint, in order.</summary>
    public List<string> Asked { get; } = [];

    /// <summary>The endpoint path each question was asked on, in the same order.</summary>
    public List<string> Endpoints { get; } = [];

    public FakeLanguageAsker Replies(params string[] lines) =>
        RepliesWith(LanguageReplyOutcome.Answered, lines);

    public FakeLanguageAsker RepliesWith(LanguageReplyOutcome outcome, params string[] lines) =>
        Script((_, _) => Task.FromResult(
            LanguageAskResult.Replied(new LanguageReply(outcome, lines))));

    public FakeLanguageAsker Absent() =>
        Script((_, _) => Task.FromResult(LanguageAskResult.Absent()));

    public FakeLanguageAsker Unavailable(string detail) =>
        Script((_, _) => Task.FromResult(LanguageAskResult.Unavailable(detail)));

    /// <summary>The asker itself fails — the case a session must survive, not model.</summary>
    public FakeLanguageAsker Throws(Exception exception) =>
        Script((_, _) => throw exception);

    /// <summary>Leaves the question outstanding until <see cref="Release"/> is called.</summary>
    public FakeLanguageAsker Holds() => Script(async (_, cancellationToken) =>
    {
        await _gate.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        return LanguageAskResult.Replied(
            new LanguageReply(LanguageReplyOutcome.Chatted, ["the answer that was held"]));
    });

    /// <summary>Lets every held question finish.</summary>
    public void Release() => _gate.TrySetResult();

    private FakeLanguageAsker Script(Func<string, CancellationToken, Task<LanguageAskResult>> answer)
    {
        _script.Enqueue(answer);
        return this;
    }

    public Task<LanguageAskResult> AskAsync(string endpointPath, string text,
        CancellationToken cancellationToken)
    {
        Asked.Add(text);
        Endpoints.Add(endpointPath);

        // Running out of scripted answers is an absence rather than an error, matching the delivery
        // fake: a test that only cares about the first question should not have to script the second.
        Func<string, CancellationToken, Task<LanguageAskResult>> answer = _script.Count > 0
            ? _script.Dequeue()
            : (_, _) => Task.FromResult(LanguageAskResult.Absent());

        return answer(text, cancellationToken);
    }
}
