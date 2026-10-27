import { Component } from "react";

export default class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  openClients = () => {
    try {
      // Reset navigation only. Saved drafts and work stay intact.
      window.localStorage.removeItem("opticards-active-view");
    } catch { /* Storage may be disabled in this browser. */ }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="loading-screen">
        <section className="workspace-strip app-recovery" role="alert">
          <h1>Не удалось открыть страницу</h1>
          <p>Повторите открытие или вернитесь к списку клиентов.</p>
          <div className="panel-actions">
            <button className="btn primary" type="button" onClick={() => this.setState({ failed: false })}>Повторить открытие</button>
            <button className="btn" type="button" onClick={this.openClients}>Открыть список клиентов</button>
          </div>
        </section>
      </main>
    );
  }
}
