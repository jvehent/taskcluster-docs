/** @jsx React.DOM */
(function(exports) {

// Create namespace
var Inspector = exports.Inspector = {};

// Widget we can initialize on load, register these later
Inspector.widgets = {};


// Render widget on load
var renderWidgets = function() {
  // Find list of elements to make into widgets
  var nodes    = document.querySelectorAll('[data-widget]');
  var elements = Array.prototype.slice.call(nodes);

  // Create widgets
  elements.forEach(function(element) {
    // Find widget to create
    var name = element.dataset.widget;
    var Widget = Inspector.widgets[name];

    // Check if widget exists
    if (!Widget) {
      return console.log("No such widget: " + name);
    }

    // Find properties
    var properties = {};
    for(var key in element.dataset) {
      properties[key] = element.dataset[key];
    }

    // Render widget on element
    React.renderComponent(new Widget(properties), element);
  });
};



/** Renders task-inspector with a control to enter `taskId` into */
var TaskInspectorWidget = React.createClass({
  mixins: [
    Utils.LoadStateMixin,
    Utils.LocationHashMixin({
      keys:     ['taskId', 'currentTab']
    })
  ],

  // Create initial state, basically nothing is loading and task doesn't exist
  getInitialState: function() {
    return {
      taskId:         '',
      statusResult:   null,
      currentTab:     ''
    };
  },

  // Create default properties
  getDefaultProps: function() {
    // Create queue and queueEvent clients
    return {
      queue:        new taskcluster.Queue(),
      queueEvents:  new taskcluster.QueueEvents()
    }
  },

  // When hash changes update state
  onHashChangedState: function(state) {
    // Reload status structure of hash changed the taskId
    if (this.state.taskId !== state.taskId) {
      this.loadTaskId(state.taskId);
      if (this.refs.taskId) {
        // Set taskId to what was provided on hash change
        this.refs.taskId.getDOMNode().value = state.taskId;
      }
    }
    if (this.refs.taskView) {
      this.refs.taskView.setCurrentTab(state.currentTab);
    }
  },

  // Load status and update UI to what was fetched from
  componentDidMount: function() {
    this.loadTaskId(this.state.taskId);
    // Set initial taskId
    this.refs.taskId.getDOMNode().value = this.state.taskId;
  },

  // Handle form submission
  onSubmit: function() {
    var taskId = this.refs.taskId.getDOMNode().value.trim();
    this.setState({taskId: taskId});
    this.loadTaskId(taskId);
    return false;
  },

  // Create new listener and load statusResult
  loadTaskId: function(taskId) {
    // Load new task status structure
    this.loadState('statusResult', this.props.queue.status(taskId));

    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    // Create new listener
    this.listener = new Listener();
    // Bind to exchanges when ready
    this.listener.addEventListener('ready', function() {
      // Create common routing key
      var rkey = {taskId: taskId};
      this.listener.bind(this.props.queueEvents.taskDefined(rkey));
      this.listener.bind(this.props.queueEvents.taskPending(rkey));
      this.listener.bind(this.props.queueEvents.taskRunning(rkey));
      this.listener.bind(this.props.queueEvents.artifactCreated(rkey));
      this.listener.bind(this.props.queueEvents.taskFailed(rkey));
      this.listener.bind(this.props.queueEvents.taskCompleted(rkey));
    }.bind(this));
    this.listener.addEventListener('error', function(err) {
      console.log("Listener error:");
      console.log(JSON.stringify(err, null, 2));
    });
    this.listener.addEventListener('bound', function(msg) {
      console.log("Listener bound: " + msg.binding.exchange);
    });
    // Find artifact exchange
    var artifactCreatedExchange = this.props.queueEvents
                                            .artifactCreated()
                                            .exchange;
    // listen for messages
    this.listener.addEventListener('message', function(data) {
      // Update state with new status structure upon getting a message
      this.setState({statusResult: data.message.payload});
      // Tell taskView to reload list of artifacts
      if (data.message.exchange === artifactCreatedExchange) {
        if (this.refs.taskView) {
          this.refs.taskView.reloadArtifacts();
        }
      }
      console.log("Listener message:");
      console.log(JSON.stringify(data, null, 2));
    }.bind(this));
  },

  componentWillUnmount: function() {
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }
  },

  // Handle tab changes from child
  onTabChange: function(tab) {
    this.setState({currentTab: tab});
  },

  // Render a task-inspector
  render: function() {
    this.renderHash();

    var display;
    if (!this.state.statusResult) {
      display = <Format.Loading subject="task status"
                                state={this.state.statusResult}/>;
    } else {
      display = <TaskView ref="taskView"
                          onTabChange={this.onTabChange}
                          status={this.state.statusResult.status}
                          queue={this.props.queue}
                          initialTab={this.state.currentTab}/>;
    }

    // Render
    return (
    <span>
    <h1>Task Inspector</h1>
    <p>This tool lets you inspect a task given the <code>taskId</code></p>
    <form className="form-horizontal" onSubmit={this.onSubmit}>
      <div className="form-group">
        <label htmlFor="taskId" className="col-sm-4 control-label">
          Enter <code>taskId</code>
        </label>
        <div className="col-sm-8">
          <input type="text"
                 className="form-control"
                 ref="taskId"
                 placeholder="taskId"/>
        </div>
      </div>
      <div className="form-group">
        <div className="col-sm-offset-2 col-sm-10">
          <input type="submit"
                 className="btn btn-primary"
                 value="Inspect task"/>
        </div>
      </div>
    </form>
    {display}
    </span>
  );}
});


// Declare TaskInspectorWidget
Inspector.widgets['task-inspector'] = TaskInspectorWidget;




/** Renders task-graph-inspector with a control to enter `taskGraphId` into */
var TaskGraphInspectorWidget = React.createClass({
  mixins: [
    Utils.LoadStateMixin,
    Utils.LocationHashMixin({
      keys:     ['taskGraphId', 'taskId', 'currentTab']
    })
  ],

  // Create initial state, basically nothing is loading and we don't have any
  // taskGraphId or taskId
  getInitialState: function() {
    return {
      taskGraphId:    '',
      taskId:         '',
      graphResult:    null,
      currentTab:     ''
    };
  },

  // Create default properties
  getDefaultProps: function() {
    // Create client instances
    return {
      scheduler:        new taskcluster.Scheduler(),
      schedulerEvents:  new taskcluster.SchedulerEvents(),
      queue:            new taskcluster.Queue(),
      queueEvents:      new taskcluster.QueueEvents()
    }
  },

  // When hash changes update state
  onHashChangedState: function(state) {
    // Reload task-graph information
    if (this.state.taskGraphId !== state.taskGraphId) {
      this.loadTaskGraph(state.taskGraphId);

      // Update taskGraphId entry
      if (this.refs.taskGraphId) {
        this.refs.taskGraphId.getDOMNode().value = this.state.taskGraphId;
      }
    }

    if (this.refs.taskView) {
      this.refs.taskView.setCurrentTab(state.currentTab);
    }
  },

  // Load status and update UI to what was fetched from
  componentDidMount: function() {
    // Load and set initial taskGraphId
    this.loadTaskGraph(this.state.taskGraphId);
    this.refs.taskGraphId.getDOMNode().value = this.state.taskGraphId;
  },

  // Handle form submission
  onSubmit: function() {
    var taskGraphId = this.refs.taskGraphId.getDOMNode().value.trim();
    this.setState({taskGraphId: taskGraphId, taskId: ''});
    this.loadGraphTask(taskGraphId);
    return false;
  },

  // Load taskGraph information
  loadTaskGraph: function(taskGraphId) {
    var scheduler = this.props.scheduler;
    var queue     = this.props.queue;

    // Inspect graph and fetch status structure for all tasks
    var getGraphResult = scheduler.inspect(taskGraphId).then(function(result) {
      // For each task
      return Promise.all(result.tasks.map(function(task) {
        // Fetch task status
        return queue.status(task.taskId).then(function(result) {
          // Store it as the status property on the result from the task-graph
          task.status = result.status;
        });
      })).then(function() {
        // return result as we've modified to feature task status structures
        return result;
      });
    });
    // Load state form promise created above
    this.loadState('graphResult', getGraphResult);

    // Close listener, if one is open
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    // Create new listener
    this.listener = new Listener();

    var queueEvents     = this.props.queueEvents;
    var schedulerEvents = this.props.schedulerEvents;

    // Bind to exchanges when ready
    this.listener.addEventListener('ready', function() {
      // Create common routing key for queue events
      var qkey = {taskGroupId: taskGraphId};
      this.listener.bind(queueEvents.taskDefined(qkey));
      this.listener.bind(queueEvents.taskPending(qkey));
      this.listener.bind(queueEvents.taskRunning(qkey));
      this.listener.bind(queueEvents.artifactCreated(qkey));
      this.listener.bind(queueEvents.taskFailed(qkey));
      this.listener.bind(queueEvents.taskCompleted(qkey));
      // Create common routing key for task-graph events
      var skey = {taskGraphId: taskGraphId};
      this.listener.bind(schedulerEvents.taskGraphRunning(skey));
      this.listener.bind(schedulerEvents.taskGraphExtended(skey));
      this.listener.bind(schedulerEvents.taskGraphBlocked(skey));
      this.listener.bind(schedulerEvents.taskGraphFinished(skey));
    }.bind(this));
    this.listener.addEventListener('error', function(err) {
      console.log("Listener error:");
      console.log(JSON.stringify(err, null, 2));
    });
    this.listener.addEventListener('bound', function(msg) {
      console.log("Listener bound: " + msg.binding.exchange);
    });
    // Find queue exchanges
    var queueExchanges = [
      queueEvents.taskDefined().exchange,
      queueEvents.taskPending().exchange,
      queueEvents.taskRunning().exchange,
      queueEvents.artifactCreated().exchange,
      queueEvents.taskFailed().exchange,
      queueEvents.taskCompleted().exchange
    ];
    // listen for messages
    this.listener.addEventListener('message', function(data) {
      console.log("Listener message:");
      console.log(JSON.stringify(data, null, 2));

      var message = data.message;

      // Check that we have a result to update before we try to update it
      if (!this.state.graphResult) {
        console.log("Not updating result with message as it's loaded yet!");
        return;
      }

      // If the message is from the queue
      if (queueExchanges.indexOf(message.exchange) !== -1) {
        // Then we must find the taskId
        var taskId = message.status.taskId;
        var result = _.cloneDeep(this.state.graphResult);
        // Update status for task that was affected
        result.tasks.forEach(function(task) {
          if (task.taskId === taskId) {
            task.status = message.status;
          }
        });
        // Update state
        this.setState({graphResult: result});

        // Tell taskView to reload list of artifacts
        if (message.exchange === queueEvents.artifactCreated().exchange) {
          if (this.refs.taskView) {
            this.refs.taskView.reloadArtifacts();
          }
        }
      }

      // If this message is from the scheduler
      if (queueExchanges.indexOf(message.exchange) === -1) {
        var result = _.cloneDeep(this.state.graphResult);
        // Update task-graph status
        result.status = message.status;
        // Update state
        this.setState({graphResult: result});
      }
    }.bind(this));
  },

  componentWillUnmount: function() {
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }
  },

  // Handle tab changes from child
  onTabChange: function(tab) {
    this.setState({currentTab: tab});
  },

  // Set current taskId
  setCurrentTaskId: function(taskId) {
    this.setState({taskId: taskId});
  },

  // Render table for task
  renderTaskTable: function() {
    var taskStateLabel = {
      unscheduled:      'label label-default',
      pending:          'label label-info',
      running:          'label label-primary',
      completed:        'label label-success',
      failed:           'label label-danger'
    };

    var currentTaskId = this.currentTaskStatus().taskId;
    var requiredTasks = [];
    var dependentTasks = [];
    this.state.graphResult.tasks.forEach(function(task) {
      // Set dependent tasks, if we're accessing the current task
      if (task.taskId == currentTaskId) {
        dependentTasks = task.dependents;
      }
      // Check if the current task is required
      if (task.dependents.indexOf(currentTaskId) !== -1) {
        requiredTasks.push(task.taskId);
      }
    });
    return (
      <table className="table table-condensed table-tasks">
        <thead>
          <tr>
            <th>TaskId</th>
            <th>Name</th>
            <th>State</th>
            <th>Reruns</th>
            <th>Relation</th>
          </tr>
        </thead>
        <tbody>
        {
          this.state.graphResult.tasks.map(function(task) {
            var href = '#' + this.state.graphResult.status.taskGraphId + '/' +
                       task.taskId;
            var stateLabel = taskStateLabel[task.status.state];
            var relation = null;
            if (requiredTasks.indexOf(task.taskId) !== -1) {
              relation = <span className={stateLabel}>required</span>;
            }
            if (dependentTasks.indexOf(task.taskId) !== -1) {
              relation = <span className="label label-info">dependent</span>;
            }
            if (task.taskId == currentTaskId) {
              relation = '-';
            }
            return (
              <tr key={task.taskId}
                  className={currentTaskId == task.taskId ? 'info' : null}
                  onClick={this.setCurrentTaskId.bind(this, task.taskId)}>
                <td><code>{task.taskId}</code></td>
                <td>
                  <Format.Markdown>
                    {task.status.name || '-'}
                  </Format.Markdown>
                </td>
                <td>
                  <span className={stateLabel}>
                    {task.status.state}
                  </span>
                </td>
                <td>
                  {task.reruns - task.rerunsLeft} of {task.reruns}
                </td>
                <td>{relation}</td>
              </tr>
            );
          }, this)
        }
        </tbody>
      </table>
    );
  },

  // Get status structure for current task
  currentTaskStatus: function() {
    var taskId = this.state.taskId;
    var status = this.state.graphResult.tasks[0].status;
    this.state.graphResult.tasks.forEach(function(task) {
      if (task.taskId == taskId) {
        status = task.status;
      }
    });
    return status;
  },

  // Render a task-graph-inspector
  render: function() {
    this.renderHash();
    var graphResult = this.state.graphResult;

    var display;
    if (!graphResult) {
      display = <Format.Loading subject="task-graph status"
                                state={this.state.graphResult}/>;
    } else {
      var taskGraphStateLabel = {
        running:          'label label-primary',
        finished:         'label label-success',
        blocked:          'label label-danger'
      };
      var source = graphResult.metadata.source;
      if (source.length > 90) {
        source = "..." + source.substr(8 - 90);
      }

      display = (
        <span>
        <hr/>
        <dl className="dl-horizontal">
          <dt>Name</dt>
          <dd>
            <Format.Markdown>
              {graphResult.metadata.name}
            </Format.Markdown>
          </dd>
          <dt>Description</dt>
          <dd>
            <Format.Markdown>
              {graphResult.metadata.description}
            </Format.Markdown>
          </dd>
          <dt>Owner</dt>
          <dd><code>{graphResult.metadata.owner}</code></dd>
          <dt>Source</dt>
          <dd>
            <a href={graphResult.metadata.source}>
              {source}
            </a>
          </dd>
        </dl>
        <dl className="dl-horizontal">
          <dt>State</dt>
          <dd>
            <span className={taskGraphStateLabel[graphResult.status.state]}>
              {graphResult.status.state}
            </span>
          </dd>
          <dt>TaskGraphId</dt>
          <dd><code>{graphResult.status.taskGraphId}</code></dd>
        </dl>
        {this.renderTaskTable()}
        <hr/>
        <TaskView ref="taskView"
                  onTabChange={this.onTabChange}
                  status={this.currentTaskStatus()}
                  queue={this.props.queue}
                  initialTab={this.state.currentTab}/>
        </span>
      );
    }

    // Render
    return (
    <span>
    <h1>Task-Graph Inspector</h1>
    <p>
      This tool lets you inspect a task-graph given the <code>taskGraphId</code>
    </p>
    <form className="form-horizontal" onSubmit={this.onSubmit}>
      <div className="form-group">
        <label htmlFor="taskGraphId" className="col-sm-4 control-label">
          Enter <code>taskGraphId</code>
        </label>
        <div className="col-sm-8">
          <input type="text"
                 className="form-control"
                 ref="taskGraphId"
                 placeholder="taskGraphId"/>
        </div>
      </div>
      <div className="form-group">
        <div className="col-sm-offset-2 col-sm-10">
          <input type="submit"
                 className="btn btn-primary"
                 value="Inspect task-graph"/>
        </div>
      </div>
    </form>
    {display}
    </span>
  );}
});


// Declare TaskGraphInspectorWidget
Inspector.widgets['task-graph-inspector'] = TaskGraphInspectorWidget;


// Render widgets when loaded
if (document.readyState !== 'complete') {
  document.addEventListener('readystatechange',function() {
    if (document.readyState === 'complete') {
      renderWidgets();
    }
  });
} else {
  renderWidgets();
}

// End of module
})(this);