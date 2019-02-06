/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

var ISSUE_SORT_ORDER = {
    BY_DEFAULT: 0,
    BY_TITLE: 1,
    BY_DUE_DATE: 2,
    BY_ASSIGNED_TO_NAME: 3,
    BY_DATECREATED: 4,
    BY_VERSION: 5
};

var ISSUE_SORT_ORDER_CHANGED_EVENT = 'ISSUE_SORT_ORDER_CHANGED_EVENT';

// *******************************************
// BIM 360 Issue Extension
// *******************************************
function BIM360IssueExtension(viewer, options) {
    Autodesk.Viewing.Extension.call(this, viewer, options);
    this.viewer = viewer;
    this.panel = null; // create the panel variable
    this.containerId = null;
    this.hubId = null;
    this.issues = null;
    this.pushPinExtensionName = 'Autodesk.BIM360.Extension.PushPin';
}

BIM360IssueExtension.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
BIM360IssueExtension.prototype.constructor = BIM360IssueExtension;

BIM360IssueExtension.prototype.load = function () {
    if (this.viewer.toolbar) {
        // Toolbar is already available, create the UI
        this.createUI();
    } else {
        // Toolbar hasn't been created yet, wait until we get notification of its creation
        this.onToolbarCreatedBinded = this.onToolbarCreated.bind(this);
        this.viewer.addEventListener(av.TOOLBAR_CREATED_EVENT, this.onToolbarCreatedBinded);
    }

    this.onSortOrderChanged = this.onSortOrderChanged.bind(this);
    this.viewer.addEventListener(ISSUE_SORT_ORDER_CHANGED_EVENT, this.onSortOrderChanged);
    return true;
};

BIM360IssueExtension.prototype.onSortOrderChanged = function (event) {
    if (!event)
        return;

    var order = event.order;

    if (!order || this.sortOrder == order)
        this.sortOrder = ISSUE_SORT_ORDER.BY_DEFAULT;
    else
        this.sortOrder = order;

    this.panel.removeAllProperties();

    var issuesCached = _.cloneDeep(this.issues);

    switch (this.sortOrder) {
        case ISSUE_SORT_ORDER.BY_TITLE:
            issuesCached = _.sortBy(issuesCached, function (i) { return i.attributes.title });
            break;

        case ISSUE_SORT_ORDER.BY_DUE_DATE:
            issuesCached = _.sortBy(issuesCached, function (i) { if (i.attributes.due_date === null) return ''; else return Date.parse(i.attributes.due_date) });
            break;

        case ISSUE_SORT_ORDER.BY_ASSIGNED_TO_NAME:
            issuesCached = _.sortBy(issuesCached, function (i) { return i.attributes.assigned_to_name });
            break;

        case ISSUE_SORT_ORDER.BY_DATECREATED:
            issuesCached = _.sortBy(issuesCached, function (i) { return i.attributes.dateCreated });
            break;

        case ISSUE_SORT_ORDER.BY_VERSION:
            issuesCached = _.sortBy(issuesCached, function (i) { return i.attributes.starting_version });
            break;

        default:
            break;
    }

    this.issuesCached = issuesCached;

    this.showIssues();
}

BIM360IssueExtension.prototype.onToolbarCreated = function () {
    this.viewer.removeEventListener(av.TOOLBAR_CREATED_EVENT, this.onToolbarCreatedBinded);
    this.onToolbarCreatedBinded = null;
    this.createUI();
};

BIM360IssueExtension.prototype.createUI = function () {
    var _this = this;

    // SubToolbar
    this.subToolbar = (this.viewer.toolbar.getControl("MyAppToolbar") ?
        this.viewer.toolbar.getControl("MyAppToolbar") :
        new Autodesk.Viewing.UI.ControlGroup('MyAppToolbar'));
    this.viewer.toolbar.addControl(this.subToolbar);

    // load/render issues button
    {
        var loadQualityIssues = new Autodesk.Viewing.UI.Button('loadQualityIssues');
        loadQualityIssues.onClick = function (e) {
            // check if the panel is created or not
            if (_this.panel == null) {
                _this.panel = new BIM360IssuePanel(_this.viewer, _this.viewer.container, 'bim360IssuePanel', 'BIM 360 Issues');
            }
            // show/hide docking panel
            _this.panel.setVisible(!_this.panel.isVisible());

            // if panel is NOT visible, exit the function
            if (!_this.panel.isVisible()) return;

            // ok, it's visible, let's load the issues
            _this.loadIssues();
        };
        loadQualityIssues.addClass('loadQualityIssues');
        loadQualityIssues.setToolTip('Show Issues');
        this.subToolbar.addControl(loadQualityIssues);
    }

    // create quality issue
    {
        var createQualityIssues = new Autodesk.Viewing.UI.Button('createQualityIssues');
        createQualityIssues.onClick = function (e) {
            var pushPinExtension = _this.viewer.getExtension(_this.pushPinExtensionName);
            if (pushPinExtension == null) {
                var extensionOptions = {
                    hideRfisButton: true,
                    hideFieldIssuesButton: true,
                };
                _this.viewer.loadExtension(_this.pushPinExtensionName, extensionOptions).then(function () { _this.createIssue(); });
            }
            else
                _this.createIssue(); // show issues
        };
        createQualityIssues.addClass('createQualityIssues');
        createQualityIssues.setToolTip('Create Issues');
        this.subToolbar.addControl(createQualityIssues);
    }
};

BIM360IssueExtension.prototype.createIssue = function () {
    var _this = this;
    var pushPinExtension = _this.viewer.getExtension(_this.pushPinExtensionName);

    var issueLabel = prompt("Enter issue label: ");
    if (issueLabel === null) return;

    // prepare to end creation...
    pushPinExtension.pushPinManager.addEventListener('pushpin.created', function (e) {
        pushPinExtension.pushPinManager.removeEventListener('pushpin.created', arguments.callee);
        pushPinExtension.endCreateItem();

        // now prepare the data
        var selected = getSelectedNode();
        var target_urn = selected.urn.split('?')[0];
        var starting_version = Number.parseInt(selected.version);
        // https://forge.autodesk.com/en/docs/bim360/v1/tutorials/pushpins/create-pushpin/
        // Once the user clicks the ``Create Pushpin`` button (see step 3), you need to grab the current position of the newly created pushpin and the pushpin data using its ID, which is automatically set to ``0``.
        var issue = pushPinExtension.getItemById('0');
        if (issue === null) return; // safeguard
        var data = {
            type: 'quality_issues',//issue.type,
            attributes: {
                title: issue.label, // In our example, this is the ``title`` the user sets in the form data (see step 3).
                // The extension retrieved the ``type`` and ``status`` properties in step 3, concatenated them, added a dash, and
                // assigned the new string to the ``status`` property of the newly created pushpin object. For example, ``issues-
                // open``.
                // You now need to extract the ``status`` (``open``) from the pushpin object.
                status: issue.status.split('-')[1] || issue.status,
                // The ``target_urn`` is the ID of the document (``item``) associated with an issue; see step 1.
                target_urn: target_urn,
                starting_version: starting_version, // See step 1 for the version ID.
                // The issue type ID and issue subtype ID. See GET ng-issue-types for more details.
                //ng_issue_subtype_id: "f6689e90-12ee-4cc8-af7a-afe10a37eeaa",
                ng_issue_type_id: "35f5c820-1e13-41e2-b553-0355b2b8b3dd",
                // ``sheet_metadata`` is the sheet in the document associated with the pushpin.
                sheet_metadata: { // `viewerApp.selectedItem` references the current sheet
                    is3D: viewerApp.selectedItem.is3D(),
                    sheetGuid: viewerApp.selectedItem.guid(),
                    sheetName: viewerApp.selectedItem.name()
                },
                pushpin_attributes: { // Data about the pushpin
                    type: 'TwoDVectorPushpin', // This is the only type currently available
                    object_id: issue.objectId, // (Only for 3D models) The object the pushpin is situated on.
                    location: issue.position, // The x, y, z coordinates of the pushpin.
                    viewer_state: issue.viewerState // The current viewer state. For example, angle, camera, zoom.
                },
            }
        };

        // submit data
        _this.getContainerId(selected.project, selected.urn, function () {
            var urn = btoa(target_urn.split('?')[0]);
            jQuery.post({
                url: '/api/forge/bim360/container/' + _this.containerId + '/issues/' + urn,
                contentType: 'application/json',
                data: JSON.stringify({ data: data }),
                success: function (res) {
                    _this.loadIssues();
                },
                error: function (err) {
                    console.log(err.responseText);
                    pushPinExtension.pushPinManager.removeItemById('0');
                    alert('Cannot create issue');
                }
            });
        });
    });

    // start asking for the push location
    pushPinExtension.startCreateItem({ label: issueLabel, status: 'open', type: 'issues' });
};

BIM360IssueExtension.prototype.submitNewIssue = function () {

};


BIM360IssueExtension.prototype.unload = function () {
    this.viewer.toolbar.removeControl(this.subToolbar);
    this.viewer.removeEventListener(ISSUE_SORT_ORDER_CHANGED_EVENT, this.onSortOrderChanged);
    return true;
};

Autodesk.Viewing.theExtensionManager.registerExtension('BIM360IssueExtension', BIM360IssueExtension);

// *******************************************
// BIM 360 Issue Panel
// *******************************************
function BIM360IssuePanel(viewer, container, id, title, options) {
    this.viewer = viewer;
    Autodesk.Viewing.UI.PropertyPanel.call(this, container, id, title, options);

    const _this = this;
    this.scrollContainer.style.height = 'calc(100% - 100px)';
    const controlsContainer = document.createElement('div');
    controlsContainer.classList.add('docking-panel-container-solid-color-a');
    controlsContainer.style.height = '30px';
    controlsContainer.style.padding = '4px';

    const titleButton = document.createElement('button');
    const assignedToButton = document.createElement('button');
    const dueDateButton = document.createElement('button');
    const createdAtButton = document.createElement('button');
    const versionButton = document.createElement('button');

    titleButton.innerText = 'Title';
    versionButton.innerText = 'Version';
    assignedToButton.innerText = 'Assigned To';
    dueDateButton.innerText = 'Due Date';
    createdAtButton.innerText = 'Created At';

    titleButton.style.color = 'black';
    versionButton.style.color = 'black';
    assignedToButton.style.color = 'black';
    dueDateButton.style.color = 'black';
    createdAtButton.style.color = 'black';

    controlsContainer.appendChild(titleButton);
    controlsContainer.appendChild(versionButton);
    controlsContainer.appendChild(assignedToButton);
    controlsContainer.appendChild(dueDateButton);
    controlsContainer.appendChild(createdAtButton);
    this.container.appendChild(controlsContainer);

    assignedToButton.onclick = function (e) {
        _this.viewer.fireEvent({
            type: ISSUE_SORT_ORDER_CHANGED_EVENT,
            order: ISSUE_SORT_ORDER.BY_ASSIGNED_TO_NAME
        });
    };
    titleButton.onclick = function (e) {
        _this.viewer.fireEvent({
            type: ISSUE_SORT_ORDER_CHANGED_EVENT,
            order: ISSUE_SORT_ORDER.BY_TITLE
        });
    };
    createdAtButton.onclick = function (e) {
        _this.viewer.fireEvent({
            type: ISSUE_SORT_ORDER_CHANGED_EVENT,
            order: ISSUE_SORT_ORDER.BY_DATECREATED
        });
    };

    dueDateButton.onclick = function (e) {
        _this.viewer.fireEvent({
            type: ISSUE_SORT_ORDER_CHANGED_EVENT,
            order: ISSUE_SORT_ORDER.BY_DUE_DATE
        });
    };
    versionButton.onclick = function (e) {
        _this.viewer.fireEvent({
            type: ISSUE_SORT_ORDER_CHANGED_EVENT,
            order: ISSUE_SORT_ORDER.BY_VERSION
        });
    };
}
BIM360IssuePanel.prototype = Object.create(Autodesk.Viewing.UI.PropertyPanel.prototype);
BIM360IssuePanel.prototype.constructor = BIM360IssuePanel;

// *******************************************
// Issue specific features
// *******************************************
BIM360IssueExtension.prototype.loadIssues = function (containerId, urn) {

    //probably it is unneccesary to get container id and urn again
    //because Pushpin initialization has done.
    //but still keep these line 
    var _this = this;
    var selected = getSelectedNode();

    _this.getContainerId(selected.project, selected.urn, function () {
        _this.getIssues(_this.hubId, _this.containerId, selected.urn, true);
    });
}

BIM360IssueExtension.prototype.getContainerId = function (href, urn, cb) {
    var _this = this;
    if (_this.panel) {
        _this.panel.removeAllProperties();
        _this.panel.addProperty('Loading...', '');
    }
    jQuery.ajax({
        url: '/api/forge/bim360/container?href=' + href,
        success: function (res) {
            _this.containerId = res.containerId;
            _this.hubId = res.hubId;
            cb();
        }

    });
}

BIM360IssueExtension.prototype.getIssues = function (accountId, containerId, urn) {
    var _this = this;
    urn = urn.split('?')[0]
    urn = btoa(urn);

    jQuery.get('/api/forge/bim360/account/' + accountId + '/container/' + containerId + '/issues/' + urn, function (data) {
        _this.issues = _.cloneDeep(data);
        _this.issuesCached = _.cloneDeep(_this.issues);

        // do we have issues on this document?
        var pushPinExtension = _this.viewer.getExtension(_this.pushPinExtensionName);
        if (_this.panel) _this.panel.removeAllProperties();
        if (data.length > 0) {
            if (pushPinExtension == null) {
                var extensionOptions = {
                    hideRfisButton: true,
                    hideFieldIssuesButton: true,
                };
                _this.viewer.loadExtension(_this.pushPinExtensionName, extensionOptions).then(function () { _this.showIssues(); }); // show issues (after load extension)
            }
            else
                _this.showIssues(); // show issues
        }
        else {
            if (_this.panel) _this.panel.addProperty('No issues found', 'Use create issues button');
        }
    }).fail(function (error) {
        alert('Cannot read Issues');
    });
}

BIM360IssueExtension.prototype.showIssues = function () {
    var _this = this;

    //remove the list of last time
    pushPinExtension = _this.viewer.getExtension(_this.pushPinExtensionName);
    pushPinExtension.removeAllItems();
    pushPinExtension.showAll();
    var selected = getSelectedNode();

    var now = new Date();
    var issueIdsExpired = this.issuesCached.filter(function (i) {
        if (i.attributes.due_date != null) {
            var dueDate = Date.parse(i.attributes.due_date);
            return dueDate < now;
        }
    })
        .map(function (i) {
            return i.id;
        });

    var onPushPinCreated = function (event) {

        //Dewi's code
        //if (issueIdsExpired.length <= 0) {
        //    pushPinExtension.pushPinManager.removeEventListener(
        //        'pushpin.created',
        //        onPushPinCreated
        //    );
        //}

        //console.log('pushpin.created', event);

        //var idx = issueIdsExpired.indexOf(event.value.itemData.id);
        //if (idx != -1) {
        //    $(event.value.marker).addClass('my-pushpin-billboard-marker');
        //    issueIdsExpired.splice(idx, 1);
        //}

        //Xiaodong's codes
        var due_date = (new Date(event.value.itemData.due_date)).getTime(); 
        var current_date = (new Date()).getTime(); 
        if (due_date < current_date) { 
            //do the job you need 
            $(event.value.marker).addClass('my-pushpin-billboard-marker'); 
        } 
    };

    pushPinExtension.addEventListener(
        Autodesk.BIM360.Extension.PushPin.PUSH_PIN_CREATED_EVENT,
        onPushPinCreated
    );

    this.issuesCached.forEach(function (issue) {
        var dateCreated = moment(issue.attributes.created_at);

        // show issue on panel
        if (_this.panel) {
            _this.panel.addProperty('Title', issue.attributes.title, 'Issue ' + issue.attributes.identifier);
            //_this.panel.addProperty('Location', stringOrEmpty(issue.attributes.location_description), 'Issue ' + issue.attributes.identifier);
            _this.panel.addProperty('Version', 'V' + issue.attributes.starting_version + (selected.version != issue.attributes.starting_version ? ' (Not current)' : ''), 'Issue ' + issue.attributes.identifier);
            _this.panel.addProperty('Created at', dateCreated.format('MMMM Do YYYY, h:mm a'), 'Issue ' + issue.attributes.identifier);
            _this.panel.addProperty('Assigned to', issue.attributes.assigned_to_name, 'Issue ' + issue.attributes.identifier);
            _this.panel.addProperty('Due Date', issue.attributes.due_date, 'Issue ' + issue.attributes.identifier);
        }

        // add the pushpin
        var issueAttributes = issue.attributes;
        var pushpinAttributes = issue.attributes.pushpin_attributes;
        if (pushpinAttributes) {
            issue.type = issue.type.replace('quality_', ''); // temp fix during issues > quality_issues migration
            pushPinExtension.createItem({
                id: issue.id,
                label: issueAttributes.identifier,
                status: issue.type && issueAttributes.status.indexOf(issue.type) === -1 ? `${issue.type}-${issueAttributes.status}` : issueAttributes.status,
                position: pushpinAttributes.location,
                type: issue.type,
                objectId: pushpinAttributes.object_id,
                viewerState: pushpinAttributes.viewer_state
            });

             //get the newest pushpin added. attach additional datta explictly. Note: the newest one is indexed with 0. 
            pushPinExtension.pushPinManager.pushPinList[0].itemData.due_date = issue.attributes.due_date; 
         }
    });
}

// *******************************************
// Helper functions
// *******************************************
function getSelectedNode() {
    var node = $('#userHubs').jstree(true).get_selected(true)[0];
    var parent;
    for (var i = 0; i < node.parents.length; i++) {
        var p = node.parents[i];
        if (p.indexOf('hubs') > 0 && p.indexOf('projects') > 0) parent = p;
    }

    if (node.id.indexOf('|') > -1) { // Plans folder
        var params = node.id.split("|");
        return { 'project': parent, 'urn': params[0], 'version': params[3] };
    }
    else { // other folders
        for (var i = 0; i < node.parents.length; i++) {
            var parent = node.parents[i];
            if (parent.indexOf('hubs') > 0 && parent.indexOf('projects') > 0) {
                var version = atob(node.id.replace('_', '/')).split('=')[1]
                return { 'project': parent, 'urn': (node.type == 'versions' ? id(node.parents[0]) : ''), version: version };
            }
        }
    }
    return null;
}

function id(href) {
    return href.substr(href.lastIndexOf('/') + 1, href.length);
}

function stringOrEmpty(str) {
    if (str == null) return '';
    return str;
}
